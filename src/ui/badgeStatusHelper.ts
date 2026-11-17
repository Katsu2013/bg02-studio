/**
 * @module ui/badgeStatusHelper
 * Shared presentation formatters for BG02 badge connection state, battery readouts,
 * and HiDPI circular thumbnail rendering across Home, Send, Badges, and Detail screens.
 */

import { interpolate } from "../i18n/i18n";
import type { TranslationSchema } from "../i18n/types";
import type { AppStateSnapshot } from "../state/appStore";
import type { SavedBadgeProfile } from "../state/deviceRegistry";

/** Normalized connection state display metadata shared across badge cards and detail views. */
export interface BadgeStatusSummary {
  /** Localized connection label (`"接続中"`, `"未接続"`, etc.). */
  readonly statusLabel: string;
  /** Semantic tone attribute (`"ok" | "info" | "warn" | undefined`) for styling + icons. */
  readonly tone: "ok" | "info" | "warn" | undefined;
  /** True strictly when this badge matches the active GATT session. */
  readonly isConnectedHere: boolean;
  /** Localized battery text distinguishing live, cached prior-session, and unconfirmed values. */
  readonly batteryText: string;
  /** True when known battery (live or last known) is critically low (`< 20%`). */
  readonly isLowBattery: boolean;
}

/**
 * Resolves consistent badge connection status and battery wording without leaking
 * telemetry from another simultaneously connected device.
 *
 * @param profile - Saved badge profile to summarize.
 * @param state - Current reactive store snapshot.
 * @param dict - Active localized translation dictionary.
 * @returns Shared {@link BadgeStatusSummary} for UI rendering.
 */
export function resolveBadgeStatusSummary(
  profile: SavedBadgeProfile,
  state: AppStateSnapshot,
  dict: TranslationSchema
): BadgeStatusSummary {
  const isConnectedHere =
    state.connectionStatus === "connected" &&
    state.activeDeviceId === profile.id &&
    state.metadata?.deviceId === profile.id;

  const isConnectingHere =
    state.connectionStatus === "connecting" &&
    (state.pendingConnectDeviceId === profile.id || state.activeDeviceId === profile.id);

  const isReconnectingHere =
    state.reconnectStatus !== null &&
    state.reconnectStatus.targetDeviceId === profile.id;

  let statusLabel: string;
  let tone: "ok" | "info" | "warn" | undefined;
  if (isConnectedHere) {
    statusLabel = dict.badges.statusConnected;
    tone = "ok";
  } else if (isReconnectingHere && state.reconnectStatus) {
    statusLabel = interpolate(dict.badges.statusReconnecting, {
      attempt: state.reconnectStatus.attempt,
      max: state.reconnectStatus.maxAttempts,
    });
    tone = "info";
  } else if (isConnectingHere) {
    statusLabel = dict.badges.statusConnecting;
    tone = "info";
  } else {
    statusLabel = dict.badges.statusDisconnected;
    tone = undefined;
  }

  let batteryText: string;
  let numericBattery: number | undefined;
  if (isConnectedHere) {
    numericBattery = state.metadata?.standardInfo?.batteryPercent;
    batteryText =
      numericBattery !== undefined
        ? interpolate(dict.badges.batteryPercent, { percent: numericBattery })
        : dict.badges.batteryUnconfirmed;
  } else if (profile.lastBatteryPercent !== null && profile.lastBatteryPercent !== undefined) {
    numericBattery = profile.lastBatteryPercent;
    batteryText = `${dict.badges.prefixLastFetched} ${interpolate(dict.badges.batteryPercent, {
      percent: numericBattery,
    })}`;
  } else {
    batteryText = dict.badges.batteryUnconfirmed;
  }

  const isLowBattery = numericBattery !== undefined && numericBattery < 20;
  if (isLowBattery && isConnectedHere) {
    tone = "warn";
  }

  return {
    statusLabel,
    tone,
    isConnectedHere,
    batteryText,
    isLowBattery,
  };
}

/**
 * Draws the current 240×240 composited badge export canvas clipped cleanly inside a circle
 * onto a small display `<canvas>` thumbnail for Home and Send cards.
 *
 * @param targetCanvas - 240×240 internal thumbnail canvas.
 * @param sourceCanvas - Offscreen composited 240×240 export canvas, or `null`.
 */
export function drawCircularThumbnailCanvas(
  targetCanvas: HTMLCanvasElement,
  sourceCanvas: HTMLCanvasElement | null
): void {
  const ctx = targetCanvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const w = targetCanvas.width;
  const h = targetCanvas.height;
  ctx.clearRect(0, 0, w, h);

  if (!sourceCanvas) {
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(sourceCanvas, 0, 0, w, h);
  ctx.restore();
}
