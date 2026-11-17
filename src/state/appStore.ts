/**
 * @module state/appStore
 * Centralized reactive store holding the 5-screen navigation flow, BLE session state,
 * non-leaking Send target state, immutable retry snapshots, draft edits, and diagnostics.
 */

import type {
  Bg02ConnectFailureReason,
  BleConnectionStatus,
  BleLogEntry,
  ConnectedDeviceMetadata,
  LogLevel,
  ReconnectStatus,
  UploadProgress,
} from "../ble/types";
import type { DialErrorKey } from "../constants/ble";
import {
  createDefaultEncodingConfig,
  createDefaultTextOverlay,
  createDefaultTransform,
} from "../imaging/badgeCompositor";
import type {
  CompositedBadgeResult,
  ImageTransform,
  JpegEncodingConfig,
  TextOverlayConfig,
} from "../imaging/types";
import {
  loadDeletedDeviceIds,
  loadReconnectPrefs,
  loadSavedDeviceProfiles,
  type AutoReconnectPreferences,
  type SavedBadgeProfile,
} from "./deviceRegistry";
import type { FrozenUploadSession, PendingPrepareTarget } from "./sendSession";

/** Maximum retained BLE log lines kept in browser memory. */
export const MAX_LOG_ENTRIES = 500;

/**
 * Five-screen user workflow identifiers:
 * 1. `"home"` — Welcome / Draft entry (`ホーム`)
 * 2. `"editor"` — Circular crop, transform & text editor (`写真を整える`)
 * 3. `"send"` — Target confirmation, progress & completion/recovery (`バッジに送る`)
 * 4. `"badges"` — Saved badges switcher (`マイバッジ`)
 * 5. `"device-detail"` — Individual badge details & unpairing guide (`バッジ詳細`)
 */
export type AppScreenId = "home" | "editor" | "send" | "badges" | "device-detail";

/** Summary metadata of the currently loaded local source image. */
export interface LoadedSourceMeta {
  /** Original filename selected by the user. */
  readonly fileName: string;
  /** Natural horizontal pixel dimension of the decoded bitmap. */
  readonly naturalWidth: number;
  /** Natural vertical pixel dimension of the decoded bitmap. */
  readonly naturalHeight: number;
}

/** Explicit result banner state rendered on Screen 3 (`"send"`) after or around an upload attempt. */
export interface SendOutcomeState {
  /** High-level outcome category matching the send/recovery screen states. */
  readonly kind:
    | "completed"
    | "disconnect_or_timeout"
    | "device_refusal"
    | "unsupported"
    | "prepare_aborted"
    | "connect_failed";
  /** Destination badge `device.id` bound to this outcome, if applicable. */
  readonly targetDeviceId: string | null;
  /** User-facing badge label shown alongside the outcome message. */
  readonly targetDeviceName: string;
  /** Primary localized explanation text. */
  readonly message: string;
  /** `true` when upload failed specifically waiting for the post-95% Finish ACK. */
  readonly isFinishTimeout?: boolean;
  /** CRC-32 hex digest of the transmitted JPEG bytes when completed. */
  readonly checksumHex?: string;
  /** Payload size in bytes when completed. */
  readonly byteLength?: number;
  /** Elapsed transfer duration formatted in seconds when completed. */
  readonly durationSec?: string;
  /** Normalized device refusal key (`"low_battery" | "charging" | "storage_full" | ...`). */
  readonly errorKey?: DialErrorKey;
  /** Specific environment/firmware incompatibility reason when `kind === "unsupported"`. */
  readonly unsupportedReason?: "no_web_bluetooth" | "unsupported_algorithm" | "unverified_device";
  /** Reported WatchTheme algorithm ID when unsupported, or `null` when unavailable. */
  readonly algorithm?: number | null;
  /** Structured connection failure cause when `kind === "connect_failed"`. */
  readonly connectFailureReason?: Bg02ConnectFailureReason;
}

/** Confirmation notice shown on Screen 5 (`"device-detail"`) after removing a badge. */
export interface DetailForgetNotice {
  /** Identifier of the removed badge. */
  readonly deviceId: string;
  /** Former nickname shown in the two-sentence confirmation notice. */
  readonly deviceName: string;
  /** Whether Chrome/Edge `BluetoothDevice.forget()` successfully revoked OS permission. */
  readonly browserPermissionRevoked: boolean;
}

/** Diagnostic summary of the most recently completed dial upload, kept for Badge Details Diagnostics. */
export interface CompletedTransferDiagnostic {
  /** Destination badge `device.id` that received the upload. */
  readonly targetDeviceId: string;
  /** User-facing badge nickname at the time of completion. */
  readonly targetDeviceName: string;
  /** Hexadecimal 32-bit additive checksum matching the firmware Finish payload. */
  readonly checksumHex: string;
  /** Uploaded JPEG size in bytes. */
  readonly byteLength: number;
  /** Formatted elapsed transfer duration in seconds. */
  readonly durationSec: string;
  /** ISO-8601 timestamp recorded when the badge confirmed `FINISH_OK`. */
  readonly completedAtIso: string;
}

/** Immutable snapshot consumed by all UI modules when re-rendering. */
export interface AppStateSnapshot {
  /** Currently visible top-level screen across the 5-screen architecture. */
  readonly activeScreen: AppScreenId;
  /** Screen to return to when pressing `< Back` from Screen 4 (`"badges"`). */
  readonly badgesReturnScreen: "home" | "send";
  /** Badge identifier focused inside Screen 5 (`"device-detail"`), or `null`. */
  readonly detailDeviceId: string | null;
  /** Explicitly chosen destination badge ID for Screen 3 (`"send"`), or `null` when unselected. */
  readonly selectedSendTargetId: string | null;
  /** Target badge ID currently awaiting browser/GATT connection, or `null`. */
  readonly pendingConnectDeviceId: string | null;
  /** Current Web Bluetooth GATT connection state. */
  readonly connectionStatus: BleConnectionStatus;
  /** Whether the BLE client currently holds a live cached device handle. */
  readonly canReconnect: boolean;
  /** Verified hardware/display telemetry for the live connected badge only. */
  readonly metadata: ConnectedDeviceMetadata | null;
  /** Discovery toggle enabling `acceptAllDevices: true` when UUID ads are omitted. */
  readonly acceptAllDevices: boolean;
  /** Write pacing preference (`writeValueWithoutResponse` vs ACKed `writeValueWithResponse`). */
  readonly preferWriteWithoutResponse: boolean;
  /** Non-deleted saved BG02 badge profiles persisted in browser storage. */
  readonly savedDevices: ReadonlyArray<SavedBadgeProfile>;
  /** Tombstone IDs of user-deleted badges filtered from `getDevices()` startup reconnect. */
  readonly deletedDeviceIds: ReadonlyArray<string>;
  /** Permitted `device.id` values exposed by `navigator.bluetooth.getDevices()`. */
  readonly liveDeviceIds: ReadonlyArray<string>;
  /** Live connected BLE client `device.id`, or `null` when disconnected. */
  readonly activeDeviceId: string | null;
  /** Saved automatic reconnect toggles and most recent badge candidate ID. */
  readonly reconnectPrefs: AutoReconnectPreferences;
  /** Live automatic reconnect loop status, or `null` when idle. */
  readonly reconnectStatus: ReconnectStatus | null;
  /** Metadata of loaded source bitmap, or `null` when starting blank/text-only. */
  readonly sourceMeta: LoadedSourceMeta | null;
  /** Geometric photo crop/zoom/rotation parameters. */
  readonly transform: ImageTransform;
  /** Baked-in canvas text overlay settings. */
  readonly textOverlay: TextOverlayConfig;
  /** Whether the inline text-editing card is expanded inside Screen 2 (`"editor"`). */
  readonly textEditorOpen: boolean;
  /** Baseline JPEG encoding mode and quality settings. */
  readonly encoding: JpegEncodingConfig;
  /** Monotonic counter incremented on every draft photo, transform, text, or encoding change. */
  readonly draftGeneration: number;
  /** `true` while decoding a newly picked image file. */
  readonly isLoadingImage: boolean;
  /** `true` while compositing/encoding the 240×240 Baseline JPEG preview. */
  readonly isEncodingDraft: boolean;
  /** Localized non-destructive error banner shown if the latest image load failed. */
  readonly imageLoadError: string | null;
  /** Latest composited 240×240 JPEG result matching `draftGeneration`, or `null`. */
  readonly latestOutput: CompositedBadgeResult | null;
  /** Synchronous target+draft lock held while async JPEG preparation runs before BLE writes start. */
  readonly preparingSend: PendingPrepareTarget | null;
  /** Immutable JPEG payload pinned at send start and reused across retries until edited. */
  readonly frozenRetrySession: FrozenUploadSession | null;
  /** Live chunk transfer progress (`"start" | "transferring" | "awaiting_finish"`), or `null`. */
  readonly uploadProgress: UploadProgress | null;
  /** Structured outcome displayed inside Screen 3 (`"send"`), or `null`. */
  readonly sendOutcome: SendOutcomeState | null;
  /** Diagnostic summary of the most recently completed upload, rendered in Device Details Diagnostics. */
  readonly lastCompletedTransfer: CompletedTransferDiagnostic | null;
  /** Warning flag set when browser Back/Forward lands on a drifted send target. */
  readonly targetDriftNotice: boolean;
  /** Post-removal feedback displayed on Screen 5 (`"device-detail"`). */
  readonly detailForgetNotice: DetailForgetNotice | null;
  /** Optional generic upload success announcement text, or `null`. */
  readonly uploadSuccessBanner: string | null;
  /** Optional generic action error banner text, or `null`. */
  readonly actionErrorBanner: string | null;
  /** Timestamped BLE/system diagnostic log lines. */
  readonly logs: ReadonlyArray<BleLogEntry>;
  /** `true` strictly when Service Worker control and scoped app shell cache are confirmed. */
  readonly serviceWorkerActive: boolean;
}

/** Subscriber callback notified synchronously after every state update. */
export type StoreListener = (state: AppStateSnapshot) => void;

/**
 * Reactive store driving all 5 screens of BG02 Studio.
 */
export class AppStore {
  /** Current immutable reactive state snapshot. */
  private state: AppStateSnapshot;
  /** Registered subscriber listeners notified synchronously on mutation. */
  private readonly listeners = new Set<StoreListener>();
  /** Monotonically increasing log entry ID counter. */
  private nextLogId = 1;
  /** Startup wall-clock baseline used to format elapsed log timestamps. */
  private readonly startEpochMs = Date.now();

  /**
   * Initializes application state from saved non-deleted badge profiles and reconnect preferences.
   */
  public constructor() {
    const deletedDeviceIds = loadDeletedDeviceIds();
    const deletedSet = new Set(deletedDeviceIds);
    const savedDevices = loadSavedDeviceProfiles().filter((d) => !deletedSet.has(d.id));
    const reconnectPrefs = loadReconnectPrefs();
    const initialDetailId =
      reconnectPrefs.lastActiveDeviceId &&
      savedDevices.some((d) => d.id === reconnectPrefs.lastActiveDeviceId)
        ? reconnectPrefs.lastActiveDeviceId
        : (savedDevices[0]?.id ?? null);

    this.state = {
      activeScreen: "home",
      badgesReturnScreen: "home",
      detailDeviceId: initialDetailId,
      selectedSendTargetId: null,
      pendingConnectDeviceId: null,
      connectionStatus: "disconnected",
      canReconnect: false,
      metadata: null,
      acceptAllDevices: true,
      preferWriteWithoutResponse: false,
      savedDevices,
      deletedDeviceIds,
      liveDeviceIds: [],
      activeDeviceId: null,
      reconnectPrefs,
      reconnectStatus: null,
      sourceMeta: null,
      transform: createDefaultTransform(),
      textOverlay: createDefaultTextOverlay(),
      textEditorOpen: false,
      encoding: createDefaultEncodingConfig(),
      draftGeneration: 0,
      isLoadingImage: false,
      isEncodingDraft: false,
      imageLoadError: null,
      latestOutput: null,
      preparingSend: null,
      frozenRetrySession: null,
      uploadProgress: null,
      sendOutcome: null,
      lastCompletedTransfer: null,
      targetDriftNotice: false,
      detailForgetNotice: null,
      uploadSuccessBanner: null,
      actionErrorBanner: null,
      logs: [],
      serviceWorkerActive: false,
    };
  }

  /**
   * Returns the current immutable state snapshot.
   */
  public get snapshot(): AppStateSnapshot {
    return this.state;
  }

  /**
   * Registers a listener and immediately delivers the current snapshot.
   *
   * @param listener - Callback invoked on initial registration and every update.
   * @returns Unsubscribe function.
   */
  public subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Merges top-level fields into state and notifies subscribers.
   *
   * @param patch - Partial snapshot update object.
   */
  public patchState(patch: Partial<AppStateSnapshot>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  /**
   * Updates photo transform parameters, increments `draftGeneration`, and invalidates stale retry state.
   *
   * @param patch - Partial geometric transform patch.
   */
  public updateTransform(patch: Partial<ImageTransform>): void {
    this.state = {
      ...this.state,
      transform: { ...this.state.transform, ...patch },
      draftGeneration: this.state.draftGeneration + 1,
      imageLoadError: null,
      frozenRetrySession: null,
      sendOutcome: null,
      uploadSuccessBanner: null,
      actionErrorBanner: null,
    };
    this.emit();
  }

  /**
   * Updates baked-in text overlay settings, increments `draftGeneration`, and invalidates stale retry state.
   *
   * @param patch - Partial text overlay patch.
   */
  public updateTextOverlay(patch: Partial<TextOverlayConfig>): void {
    this.state = {
      ...this.state,
      textOverlay: { ...this.state.textOverlay, ...patch },
      draftGeneration: this.state.draftGeneration + 1,
      imageLoadError: null,
      frozenRetrySession: null,
      sendOutcome: null,
      uploadSuccessBanner: null,
      actionErrorBanner: null,
    };
    this.emit();
  }

  /**
   * Updates Baseline JPEG encoding settings, increments `draftGeneration`, and invalidates stale retry state.
   *
   * @param patch - Partial encoding configuration patch.
   */
  public updateEncoding(patch: Partial<JpegEncodingConfig>): void {
    this.state = {
      ...this.state,
      encoding: { ...this.state.encoding, ...patch },
      draftGeneration: this.state.draftGeneration + 1,
      frozenRetrySession: null,
      sendOutcome: null,
      uploadSuccessBanner: null,
      actionErrorBanner: null,
    };
    this.emit();
  }

  /**
   * Replaces loaded source photo metadata, increments `draftGeneration`, and resets prior upload banners.
   *
   * @param sourceMeta - Decoded image metadata, or `null` when clearing photo.
   * @param transformPatch - Optional transform override (e.g. centered fit when loading a new file).
   */
  public setSourceMeta(
    sourceMeta: LoadedSourceMeta | null,
    transformPatch?: ImageTransform
  ): void {
    this.state = {
      ...this.state,
      sourceMeta,
      transform: transformPatch ?? this.state.transform,
      draftGeneration: this.state.draftGeneration + 1,
      isLoadingImage: false,
      imageLoadError: null,
      frozenRetrySession: null,
      sendOutcome: null,
      uploadSuccessBanner: null,
      actionErrorBanner: null,
    };
    this.emit();
  }

  /**
   * Appends a timestamped communication log entry, capping history at {@link MAX_LOG_ENTRIES}.
   *
   * @param level - Severity / direction tag.
   * @param message - Human-readable diagnostic line.
   */
  public appendLog(level: LogLevel, message: string): void {
    const elapsedSec = Math.floor((Date.now() - this.startEpochMs) / 1000);
    const hours = Math.floor(elapsedSec / 3600);
    const mins = Math.floor((elapsedSec % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const secs = (elapsedSec % 60).toString().padStart(2, "0");

    const entry: BleLogEntry = {
      id: this.nextLogId++,
      timestamp: `${hours}:${mins}:${secs}`,
      level,
      message,
    };

    const nextLogs =
      this.state.logs.length >= MAX_LOG_ENTRIES
        ? [...this.state.logs.slice(this.state.logs.length - MAX_LOG_ENTRIES + 1), entry]
        : [...this.state.logs, entry];

    this.state = { ...this.state, logs: nextLogs };
    this.emit();
  }

  /**
   * Clears retained communication log entries cleanly.
   */
  public clearLogs(): void {
    this.state = { ...this.state, logs: [] };
    this.emit();
  }

  /** Dispatches the latest snapshot to every subscribed listener. */
  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
