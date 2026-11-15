/**
 * @module state/deviceRegistry
 * Local multi-device profile management, custom badge nicknames, accent color assignment,
 * and auto-reconnect preference persistence via browser `localStorage`.
 */

/** `localStorage` key storing the array of remembered {@link SavedBadgeProfile} objects. */
export const DEVICE_REGISTRY_STORAGE_KEY = "bg02-studio.devices.v1";

/** `localStorage` key storing user auto-reconnect preferences and last active device ID. */
export const RECONNECT_PREFS_STORAGE_KEY = "bg02-studio.reconnectPrefs.v1";

/** Distinct visual tag colors cycled automatically as additional BG02 badges are paired. */
export const DEVICE_ACCENT_PALETTE: ReadonlyArray<string> = [
  "#38bdf8", // Sky cyan
  "#a78bfa", // Violet
  "#34d399", // Emerald
  "#fbbf24", // Amber
  "#f472b6", // Rose pink
  "#fb7185", // Coral
];

/** Persistent user-friendly profile identifying one physical BG02 badge. */
export interface SavedBadgeProfile {
  /** Browser-scoped Web Bluetooth `device.id` distinguishing identical `BG02` units. */
  readonly id: string;
  /** Advertised GAP device name (`"BG02"`). */
  readonly advertisedName: string;
  /** Editable user-chosen display nickname (`"BG02 #1"`, `"Bag Badge"`, etc.). */
  readonly nickname: string;
  /** Distinct accent ring hex color making multi-badge switching immediately recognizable. */
  readonly accentHex: string;
  /** Last observed battery percentage (`0..100`), or `null` if unknown. */
  readonly lastBatteryPercent: number | null;
  /** Epoch timestamp (ms) of the latest successful connection/sync, or `null`. */
  readonly lastConnectedAtMs: number | null;
  /** Optional last observed firmware revision string (e.g. `"V36004"`). */
  readonly lastFirmwareRevision?: string | null;
  /** Optional last observed hardware/display specification summary (e.g. `"240×240"`). */
  readonly lastDisplaySpec?: string | null;
  /** Optional last observed free flash storage byte count. */
  readonly lastFreeStorageBytes?: number | null;
}

/** Persistent auto-reconnect behavior settings. */
export interface AutoReconnectPreferences {
  /** Automatically retry GATT connection (up to 3×) if an active link drops unexpectedly. */
  readonly autoRetryOnDrop: boolean;
  /** Automatically attempt connecting to the last active permitted badge upon app startup. */
  readonly autoConnectOnStartup: boolean;
  /** Last successfully connected `device.id` targeted first on startup/reconnect. */
  readonly lastActiveDeviceId: string | null;
}

/** Upsert parameters supplied whenever a BG02 badge connects or updates telemetry. */
export interface DeviceProfileUpsertInput {
  /** Web Bluetooth device identifier. */
  readonly id: string;
  /** Advertised GAP name (`"BG02"`). */
  readonly advertisedName: string;
  /** Optional freshly read battery level. */
  readonly batteryPercent?: number;
  /** Optional freshly read firmware revision string. */
  readonly firmwareRevision?: string;
  /** Optional freshly formatted display summary string. */
  readonly displaySpec?: string;
  /** Optional freshly read free storage bytes. */
  readonly freeStorageBytes?: number | null;
  /** Connection epoch override (defaults to `Date.now()`). */
  readonly connectedAtMs?: number;
}

/**
 * Creates default auto-reconnect settings with both drop recovery and startup auto-connect enabled.
 *
 * @returns Initial {@link AutoReconnectPreferences}.
 */
export function createDefaultReconnectPrefs(): AutoReconnectPreferences {
  return {
    autoRetryOnDrop: true,
    autoConnectOnStartup: true,
    lastActiveDeviceId: null,
  };
}

/**
 * Inserts a newly discovered badge or updates metadata on an existing remembered badge,
 * assigning numbered default nicknames and distinct accent colors automatically.
 *
 * @param existing - Current saved badge list.
 * @param input - Discovered or reconnected device identity and telemetry.
 * @returns Newly constructed immutable array of {@link SavedBadgeProfile} items.
 */
export function upsertDeviceProfile(
  existing: ReadonlyArray<SavedBadgeProfile>,
  input: DeviceProfileUpsertInput
): ReadonlyArray<SavedBadgeProfile> {
  const index = existing.findIndex((item) => item.id === input.id);
  const now = input.connectedAtMs ?? Date.now();
  const safeName = input.advertisedName.trim() || "BG02";

  if (index >= 0) {
    const prev = existing[index];
    const updated: SavedBadgeProfile = {
      ...prev,
      advertisedName: safeName,
      lastBatteryPercent:
        input.batteryPercent !== undefined ? input.batteryPercent : prev.lastBatteryPercent,
      lastFirmwareRevision:
        input.firmwareRevision !== undefined ? input.firmwareRevision : prev.lastFirmwareRevision,
      lastDisplaySpec:
        input.displaySpec !== undefined ? input.displaySpec : prev.lastDisplaySpec,
      lastFreeStorageBytes:
        input.freeStorageBytes !== undefined
          ? input.freeStorageBytes
          : prev.lastFreeStorageBytes,
      lastConnectedAtMs: now,
    };
    return [...existing.slice(0, index), updated, ...existing.slice(index + 1)];
  }

  const nextOrdinal = existing.length + 1;
  const accentHex = DEVICE_ACCENT_PALETTE[existing.length % DEVICE_ACCENT_PALETTE.length];
  const created: SavedBadgeProfile = {
    id: input.id,
    advertisedName: safeName,
    nickname: `${safeName} #${nextOrdinal}`,
    accentHex,
    lastBatteryPercent: input.batteryPercent ?? null,
    lastFirmwareRevision: input.firmwareRevision ?? null,
    lastDisplaySpec: input.displaySpec ?? null,
    lastFreeStorageBytes: input.freeStorageBytes ?? null,
    lastConnectedAtMs: now,
  };
  return [...existing, created];
}

/**
 * Updates the custom user nickname for a registered badge while preserving fallback text on blank input.
 *
 * @param existing - Current saved badge list.
 * @param id - Target Web Bluetooth device ID.
 * @param nextNickname - Trimmed plain text nickname typed by user.
 * @returns Updated list of profiles.
 */
export function renameDeviceProfile(
  existing: ReadonlyArray<SavedBadgeProfile>,
  id: string,
  nextNickname: string
): ReadonlyArray<SavedBadgeProfile> {
  const trimmed = nextNickname.trim().slice(0, 32);
  if (!trimmed) {
    return existing;
  }
  return existing.map((item) => (item.id === id ? { ...item, nickname: trimmed } : item));
}

/**
 * Removes a remembered badge profile from the saved switcher list.
 *
 * @param existing - Current saved badge list.
 * @param id - Target Web Bluetooth device ID to forget.
 * @returns Filtered list without the specified device.
 */
export function removeDeviceProfile(
  existing: ReadonlyArray<SavedBadgeProfile>,
  id: string
): ReadonlyArray<SavedBadgeProfile> {
  return existing.filter((item) => item.id !== id);
}

/** Resolved target parameters when initiating upload-time reconnection. */
export interface UploadReconnectPlan {
  /** Whether an existing device handle/ID should be reused before falling back to browser picker. */
  readonly reuseDevice: boolean;
  /** Preferred target device identifier, or `undefined` when no badge has been paired yet. */
  readonly targetDeviceId: string | undefined;
}

/** Input snapshot needed to choose which badge {@link resolveUploadReconnectPlan} should connect to. */
export interface UploadReconnectInputs {
  /** Currently selected device ID tracked in UI state, or `null`. */
  readonly activeDeviceId: string | null;
  /** Currently active device ID inside the BLE client cache, or `null`. */
  readonly clientActiveId: string | null;
  /** Whether the BLE client currently holds an active cached device reference. */
  readonly canReconnect: boolean;
  /** Remembered saved badge profiles from local storage. */
  readonly savedDevices: ReadonlyArray<SavedBadgeProfile>;
  /** Permitted live `BluetoothDevice` IDs reported by `navigator.bluetooth.getDevices()`. */
  readonly liveDeviceIds: ReadonlyArray<string>;
  /** Persisted auto-reconnect preferences (`lastActiveDeviceId`). */
  readonly prefs: AutoReconnectPreferences;
}

/**
 * Selects the most recently connected profile ID from `profiles`, optionally restricted to `allowedIds`.
 *
 * @param profiles - Saved user badge profiles.
 * @param allowedIds - Optional whitelist of currently permitted device IDs.
 * @returns Matching `device.id`, or `null` if no entry qualifies.
 */
function pickMostRecentProfileId(
  profiles: ReadonlyArray<SavedBadgeProfile>,
  allowedIds?: ReadonlySet<string>
): string | null {
  let bestId: string | null = null;
  let bestTime = -1;
  for (const profile of profiles) {
    if (allowedIds && !allowedIds.has(profile.id)) {
      continue;
    }
    const ts = profile.lastConnectedAtMs ?? 0;
    if (ts > bestTime) {
      bestTime = ts;
      bestId = profile.id;
    }
  }
  return bestId;
}

/**
 * Selects which device ID should be targeted automatically on app startup given persisted preferences
 * and the browser's live permitted `navigator.bluetooth.getDevices()` set.
 *
 * // 意図: 前回アクティブだった端末が現在ブラウザ側に権限保持されていれば優先し、見つからない場合のみ他端末へフォールバックする。
 *
 * @param profiles - Saved user badge profiles sorted by addition.
 * @param permittedDeviceIds - Device IDs returned by the browser `getDevices()` API.
 * @param prefs - Stored auto-reconnect preferences.
 * @returns Matching `device.id` to auto-connect on startup, or `null` when startup auto-connect cannot proceed.
 */
export function pickStartupReconnectTarget(
  profiles: ReadonlyArray<SavedBadgeProfile>,
  permittedDeviceIds: ReadonlySet<string>,
  prefs: AutoReconnectPreferences
): string | null {
  if (!prefs.autoConnectOnStartup || permittedDeviceIds.size === 0) {
    return null;
  }

  if (prefs.lastActiveDeviceId && permittedDeviceIds.has(prefs.lastActiveDeviceId)) {
    return prefs.lastActiveDeviceId;
  }

  const recentId = pickMostRecentProfileId(profiles, permittedDeviceIds);
  if (recentId) {
    return recentId;
  }

  // Fallback to first live browser-permitted badge even if cleared from localStorage
  for (const permittedId of permittedDeviceIds) {
    return permittedId;
  }
  return null;
}

/**
 * Resolves the target badge profile ID and whether cached handle reuse should be attempted
 * when initiating an image upload while the BLE session is disconnected.
 *
 * // 意図: 画像送信ボタン押下時に未接続だった場合でも、保存済み端末やライブハンドルを優先再利用し、
 * //       キャッシュ切れ時は handleConnect 内でブラウザ選択ピッカーへ自然フォールバックさせる。
 *
 * @param input - Current active device, saved badges, cached handle IDs, and reconnect preferences.
 * @returns Concrete `{ reuseDevice, targetDeviceId }` plan for pre-upload connection recovery.
 */
export function resolveUploadReconnectPlan(input: UploadReconnectInputs): UploadReconnectPlan {
  const directCandidate =
    input.activeDeviceId ?? input.clientActiveId ?? input.prefs.lastActiveDeviceId;
  if (directCandidate) {
    return {
      reuseDevice: true,
      targetDeviceId: directCandidate,
    };
  }

  const liveSet = new Set(input.liveDeviceIds);
  const recentLiveId = pickMostRecentProfileId(input.savedDevices, liveSet);
  if (recentLiveId) {
    return {
      reuseDevice: true,
      targetDeviceId: recentLiveId,
    };
  }

  const recentSavedId = pickMostRecentProfileId(input.savedDevices);
  if (recentSavedId) {
    return {
      reuseDevice: true,
      targetDeviceId: recentSavedId,
    };
  }

  if (input.liveDeviceIds.length > 0) {
    return {
      reuseDevice: true,
      targetDeviceId: input.liveDeviceIds[0],
    };
  }

  if (input.canReconnect) {
    return {
      reuseDevice: true,
      targetDeviceId: undefined,
    };
  }

  return {
    reuseDevice: false,
    targetDeviceId: undefined,
  };
}

/**
 * Reads saved badge profiles cleanly from `localStorage`, returning an empty list if unavailable or corrupt.
 *
 * @returns Verified array of {@link SavedBadgeProfile}.
 */
export function loadSavedDeviceProfiles(): ReadonlyArray<SavedBadgeProfile> {
  try {
    if (typeof localStorage === "undefined") {
      return [];
    }
    const raw = localStorage.getItem(DEVICE_REGISTRY_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is SavedBadgeProfile =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as SavedBadgeProfile).id === "string" &&
        typeof (item as SavedBadgeProfile).nickname === "string" &&
        typeof (item as SavedBadgeProfile).accentHex === "string"
    );
  } catch {
    return [];
  }
}

/**
 * Persists badge profiles cleanly into `localStorage`.
 *
 * @param profiles - Immutable profile list to serialize.
 */
export function saveDeviceProfiles(profiles: ReadonlyArray<SavedBadgeProfile>): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(DEVICE_REGISTRY_STORAGE_KEY, JSON.stringify(profiles));
    }
  } catch {
    // Ignore storage quota or private-mode failures
  }
}

/**
 * Reads stored auto-reconnect preferences from `localStorage`.
 *
 * @returns Normalized {@link AutoReconnectPreferences} merged with defaults.
 */
export function loadReconnectPrefs(): AutoReconnectPreferences {
  const defaults = createDefaultReconnectPrefs();
  try {
    if (typeof localStorage === "undefined") {
      return defaults;
    }
    const raw = localStorage.getItem(RECONNECT_PREFS_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<AutoReconnectPreferences>;
    return {
      autoRetryOnDrop:
        typeof parsed.autoRetryOnDrop === "boolean"
          ? parsed.autoRetryOnDrop
          : defaults.autoRetryOnDrop,
      autoConnectOnStartup:
        typeof parsed.autoConnectOnStartup === "boolean"
          ? parsed.autoConnectOnStartup
          : defaults.autoConnectOnStartup,
      lastActiveDeviceId:
        typeof parsed.lastActiveDeviceId === "string" ? parsed.lastActiveDeviceId : null,
    };
  } catch {
    return defaults;
  }
}

/**
 * Persists auto-reconnect preferences to `localStorage`.
 *
 * @param prefs - Current {@link AutoReconnectPreferences} snapshot.
 */
export function saveReconnectPrefs(prefs: AutoReconnectPreferences): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(RECONNECT_PREFS_STORAGE_KEY, JSON.stringify(prefs));
    }
  } catch {
    // Ignore storage quota or private-mode restrictions
  }
}
