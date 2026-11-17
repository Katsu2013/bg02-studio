/**
 * @module state/sendSession
 * Pure state-reconciliation and safety-gate helpers binding Send UI labels,
 * live GATT connection identity, draft generation, and confirmed WatchTheme3 payloads
 * so target mismatches, premature writes, or cross-device telemetry leaks cannot occur.
 */

import type { ConnectedDeviceMetadata } from "../ble/types";
import { hasPublishableBadgeContent } from "../imaging/badgeCompositor";
import { assessDeviceUploadSupport, isUploadableJpeg } from "../imaging/jpegInspector";
import type { CompositedBadgeResult, TextOverlayConfig } from "../imaging/types";
import type { SavedBadgeProfile } from "./deviceRegistry";

/** Immutable payload pinned at the start of an upload session and reused unchanged across retries. */
export interface FrozenUploadSession {
  /** Destination Web Bluetooth `device.id` verified before transfer begins. */
  readonly targetDeviceId: string;
  /** Human-readable display label matching `targetDeviceId` at send start. */
  readonly targetDeviceName: string;
  /** Expected target width in pixels verified from `ClockDialInfo`. */
  readonly expectedWidth: number;
  /** Expected target height in pixels verified from `ClockDialInfo`. */
  readonly expectedHeight: number;
  /** Draft edit generation captured at send confirmation time. */
  readonly draftGeneration: number;
  /** Immutable Baseline JPEG byte copy transmitted identically on every retry attempt. */
  readonly jpegBytes: Uint8Array;
}

/** Resolved non-leaking view of the chosen destination badge and its verified connection telemetry. */
export interface SendTargetViewState {
  /** Currently selected destination `device.id`, or `null` if unselected. */
  readonly targetDeviceId: string | null;
  /** User-facing display label for `targetDeviceId`, or `null` when unselected. */
  readonly targetDisplayName: string | null;
  /** Saved profile matching `targetDeviceId`, if present. */
  readonly savedProfile: SavedBadgeProfile | null;
  /** `true` strictly when GATT is live AND its `device.id` equals `targetDeviceId`. */
  readonly isTargetConnected: boolean;
  /** `true` when another badge is connected while a different `targetDeviceId` is selected. */
  readonly isDifferentDeviceConnected: boolean;
  /** Live connected metadata ONLY when `isTargetConnected` is `true` (never leaks another badge's data). */
  readonly liveMetadata: ConnectedDeviceMetadata | null;
}

/** Pre-flight refusal reasons blocking WatchTheme3 Start frames before GATT writes occur. */
export type UploadGateRejectionReason =
  | "empty_content"
  | "target_unselected"
  | "target_not_connected"
  | "stale_draft"
  | "unverified_device"
  | "unsupported_algorithm"
  | "invalid_dimensions"
  | "invalid_jpeg"
  | "low_battery_preflight"
  | "storage_full_preflight";

/** Result returned by {@link evaluateUploadGate}. */
export type UploadGateResult =
  | {
      /** Upload pre-flight succeeded and produced an immutable payload snapshot. */
      readonly allowed: true;
      /** Immutable session pinned to the verified destination device ID. */
      readonly frozenSession: FrozenUploadSession;
    }
  | {
      /** Upload pre-flight blocked before writing any `WatchTheme3` frame. */
      readonly allowed: false;
      /** Structured reason why transfer was blocked. */
      readonly reason: UploadGateRejectionReason;
    };

/**
 * Resolves the send screen's destination display name and live telemetry strictly from verified matching IDs.
 *
 * // 意図: 別端末 A が接続中かつ未接続端末 C を送り先候補にした場合でも、C の名前に A の電池残量や容量を絶対に出さない。
 *
 * @param params - Selected target ID, saved badges, live BLE client status, and metadata.
 * @returns Strictly isolated {@link SendTargetViewState}.
 */
export function resolveSendTargetView(params: {
  selectedSendTargetId: string | null;
  savedDevices: ReadonlyArray<SavedBadgeProfile>;
  clientConnected: boolean;
  clientActiveId: string | null;
  connectedMetadata: ConnectedDeviceMetadata | null;
}): SendTargetViewState {
  const {
    selectedSendTargetId,
    savedDevices,
    clientConnected,
    clientActiveId,
    connectedMetadata,
  } = params;

  if (!selectedSendTargetId) {
    return {
      targetDeviceId: null,
      targetDisplayName: null,
      savedProfile: null,
      isTargetConnected: false,
      isDifferentDeviceConnected: false,
      liveMetadata: null,
    };
  }

  const savedProfile = savedDevices.find((d) => d.id === selectedSendTargetId) ?? null;
  const isTargetConnected = Boolean(
    clientConnected &&
      clientActiveId === selectedSendTargetId &&
      connectedMetadata &&
      connectedMetadata.deviceId === selectedSendTargetId
  );

  const liveMetadata = isTargetConnected ? connectedMetadata : null;
  const targetDisplayName =
    savedProfile?.nickname ??
    (liveMetadata?.deviceName?.trim() || "BG02");

  const isDifferentDeviceConnected = Boolean(
    clientConnected && clientActiveId && clientActiveId !== selectedSendTargetId
  );

  return {
    targetDeviceId: selectedSendTargetId,
    targetDisplayName,
    savedProfile,
    isTargetConnected,
    isDifferentDeviceConnected,
    liveMetadata,
  };
}

/**
 * Validates every pre-condition before emitting a WatchTheme3 Start frame and produces an immutable payload copy.
 *
 * @param params - Draft content state, target resolution, and current composited JPEG output.
 * @returns Either an approved {@link FrozenUploadSession} or structured refusal reason.
 */
export function evaluateUploadGate(params: {
  hasSourceImage: boolean;
  textOverlay: TextOverlayConfig;
  targetView: SendTargetViewState;
  latestOutput: CompositedBadgeResult | null;
  draftGeneration: number;
}): UploadGateResult {
  const { hasSourceImage, textOverlay, targetView, latestOutput, draftGeneration } = params;

  if (!hasPublishableBadgeContent(hasSourceImage, textOverlay)) {
    return { allowed: false, reason: "empty_content" };
  }

  if (!targetView.targetDeviceId || !targetView.targetDisplayName) {
    return { allowed: false, reason: "target_unselected" };
  }

  if (!targetView.isTargetConnected || !targetView.liveMetadata) {
    return { allowed: false, reason: "target_not_connected" };
  }

  const support = assessDeviceUploadSupport(targetView.liveMetadata);
  if (!support.supported) {
    return {
      allowed: false,
      reason:
        support.reason === "unsupported_algorithm"
          ? "unsupported_algorithm"
          : support.reason === "invalid_dimensions"
            ? "invalid_dimensions"
            : "unverified_device",
    };
  }

  if (!latestOutput || latestOutput.draftGeneration !== draftGeneration) {
    return { allowed: false, reason: "stale_draft" };
  }

  if (!isUploadableJpeg(latestOutput.inspection, support.width, support.height)) {
    return { allowed: false, reason: "invalid_jpeg" };
  }

  const battery = targetView.liveMetadata.standardInfo?.batteryPercent;
  if (battery !== undefined && battery < 20) {
    return { allowed: false, reason: "low_battery_preflight" };
  }

  const freeBytes = targetView.liveMetadata.freeStorageBytes;
  if (freeBytes !== null && freeBytes < latestOutput.byteLength) {
    return { allowed: false, reason: "storage_full_preflight" };
  }

  return {
    allowed: true,
    frozenSession: {
      targetDeviceId: targetView.targetDeviceId,
      targetDeviceName: targetView.targetDisplayName,
      expectedWidth: support.width,
      expectedHeight: support.height,
      draftGeneration,
      jpegBytes: new Uint8Array(latestOutput.jpegBytes),
    },
  };
}

/** Outcome returned by {@link reconcilePopStateSendTarget} after browser history navigation. */
export interface PopStateSendReconcileResult {
  /** Next destination `device.id`, or `null` when cleared due to target drift. */
  readonly nextSelectedTargetId: string | null;
  /** `true` when the active GATT connection changed behind History Back/Forward. */
  readonly targetDriftDetected: boolean;
}

/**
 * Reconciles `selectedSendTargetId` after browser history navigation (`popstate`)
 * so advancing/returning through old history entries never silently targets a newly connected badge.
 *
 * @param params - Recorded history context ID vs. live session IDs.
 * @returns Next target ID (`null` when invalidated by drift) and whether to alert user.
 */
export function reconcilePopStateSendTarget(params: {
  routeContextDeviceId: string | null;
  currentSelectedTargetId: string | null;
  clientConnected: boolean;
  clientActiveId: string | null;
}): PopStateSendReconcileResult {
  const {
    routeContextDeviceId,
    currentSelectedTargetId,
    clientConnected,
    clientActiveId,
  } = params;

  const liveId = clientConnected ? clientActiveId : null;
  if (routeContextDeviceId !== null && liveId !== null && routeContextDeviceId !== liveId) {
    return {
      nextSelectedTargetId: null,
      targetDriftDetected: true,
    };
  }
  if (
    routeContextDeviceId !== null &&
    currentSelectedTargetId !== null &&
    routeContextDeviceId !== currentSelectedTargetId
  ) {
    return {
      nextSelectedTargetId: null,
      targetDriftDetected: true,
    };
  }
  if (routeContextDeviceId === null && liveId !== null && currentSelectedTargetId !== liveId) {
    return {
      nextSelectedTargetId: null,
      targetDriftDetected: true,
    };
  }

  return {
    nextSelectedTargetId: currentSelectedTargetId,
    targetDriftDetected: false,
  };
}

/**
 * Snapshot of target identity and draft/connection generation frozen synchronously
 * when the user clicks "〇〇 へ送る" prior to asynchronous JPEG encoding.
 */
export interface PendingPrepareTarget {
  /** Destination `WebBluetoothDevice.id` locked at send confirmation click. */
  readonly targetDeviceId: string;
  /** Destination badge display name captured at click time for UI notices. */
  readonly targetDeviceName: string;
  /** Draft state generation captured when preparation began. */
  readonly draftGeneration: number;
  /** BLE connection session generation captured when preparation began. */
  readonly bleSessionGeneration: number;
  /** Monotonic token identifying this exact preparation invocation. */
  readonly prepareToken: number;
}

/** Machine-readable reason why an async send preparation could not proceed to upload. */
export type SendPrepareDriftReason =
  | "superseded"
  | "screen_left"
  | "target_changed"
  | "connection_changed"
  | "draft_changed";

/**
 * Outcome returned by {@link verifyPreparedSendConsistency} after async JPEG encoding completes.
 */
export type SendPrepareConsistencyResult =
  | {
      /** Locked destination and draft match current app & BLE state; upload may start. */
      readonly ok: true;
    }
  | {
      /** State drifted during encoding; upload must abort cleanly with zero BLE writes. */
      readonly ok: false;
      /** Reason explaining why the prepared image must not be sent. */
      readonly reason: SendPrepareDriftReason;
    };

/** Inputs inspected immediately after async JPEG preparation finishes. */
export interface PrepareConsistencyInput {
  /** Preparation snapshot captured when the user pressed the Send button. */
  readonly pending: PendingPrepareTarget;
  /** Latest active preparation sequence token owned by the coordinator. */
  readonly currentPrepareToken: number;
  /** Currently active UI screen (`"send"` required to continue). */
  readonly activeScreen: string;
  /** Current draft mutation generation. */
  readonly currentDraftGeneration: number;
  /** Currently selected destination badge ID on the Send screen. */
  readonly currentSelectedTargetId: string | null;
  /** Live connected BLE device ID reported by `Bg02Client`, or `null` if disconnected. */
  readonly liveActiveDeviceId: string | null;
  /** Current BLE transport connectivity (`true` only when GATT server + TX are live). */
  readonly isBleConnected: boolean;
  /** Current BLE session generation reported by `Bg02Client`. */
  readonly currentBleSessionGeneration: number;
}

/**
 * Verifies that destination badge, live GATT session, screen, and draft remain identical
 * to the snapshot frozen when the user tapped "〇〇 へ送る".
 *
 * // 意図: JPEG エンコード待機中に別バッジへ接続・選択が切り替わっても、確認操作なしの誤送信を 0 バイトで阻止する。
 *
 * @param input - Current app and BLE state observed after async JPEG encoding settles.
 * @returns Consistency decision indicating whether uploading the encoded bytes is safe.
 */
export function verifyPreparedSendConsistency(
  input: PrepareConsistencyInput
): SendPrepareConsistencyResult {
  const { pending } = input;
  if (input.currentPrepareToken !== pending.prepareToken) {
    return { ok: false, reason: "superseded" };
  }
  if (input.activeScreen !== "send") {
    return { ok: false, reason: "screen_left" };
  }
  if (input.currentDraftGeneration !== pending.draftGeneration) {
    return { ok: false, reason: "draft_changed" };
  }
  if (input.currentSelectedTargetId !== pending.targetDeviceId) {
    return { ok: false, reason: "target_changed" };
  }
  if (
    !input.isBleConnected ||
    input.liveActiveDeviceId !== pending.targetDeviceId ||
    input.currentBleSessionGeneration !== pending.bleSessionGeneration
  ) {
    return { ok: false, reason: "connection_changed" };
  }
  return { ok: true };
}

/**
 * Verifies whether a deferred Editor -> Send transition initiated before async composition
 * is still valid to complete when JPEG encoding settles.
 *
 * @param params - Expected transition token vs. latest coordinator sequence and active screen.
 * @returns `true` only when the user is still on `"editor"` and no navigation/image reload superseded it.
 */
export function shouldCommitEditorProceedToSend(params: {
  readonly expectedSeq: number;
  readonly currentSeq: number;
  readonly activeScreen: string;
}): boolean {
  return params.expectedSeq === params.currentSeq && params.activeScreen === "editor";
}
