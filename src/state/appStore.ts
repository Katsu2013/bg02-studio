/**
 * @module state/appStore
 * Unidirectional observable state container managing BLE session status,
 * telemetry metadata, badge composition parameters, encoded JPEG output, and logs.
 */

import type {
  BleConnectionStatus,
  BleLogEntry,
  ConnectedDeviceMetadata,
  LogLevel,
  ReconnectStatus,
  UploadProgress,
} from "../ble/types";
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
  loadReconnectPrefs,
  loadSavedDeviceProfiles,
  type AutoReconnectPreferences,
  type SavedBadgeProfile,
} from "./deviceRegistry";

/** Maximum number of communication log lines retained in memory. */
export const MAX_LOG_ENTRIES = 500;

/**
 * Top-level drill-down screen identifiers separating Home Device List,
 * Image Select/Push flow, and Device Detail / Bluetooth Unpair instructions.
 */
export type AppScreenId = "home" | "push" | "device-detail";

/** Metadata describing the currently loaded local source bitmap. */
export interface LoadedSourceMeta {
  /** Original local file name (never sent to any remote server). */
  readonly fileName: string;
  /** Natural image width in pixels. */
  readonly naturalWidth: number;
  /** Natural image height in pixels. */
  readonly naturalHeight: number;
}

/** Complete read-only state snapshot observed by UI components. */
export interface AppStateSnapshot {
  /** Currently visible drill-down view screen (`"home" | "push" | "device-detail"`). */
  readonly activeScreen: AppScreenId;
  /** Badge identifier focused inside the Device Detail & Unpair view, or `null`. */
  readonly detailDeviceId: string | null;
  /** Current BLE GATT lifecycle status. */
  readonly connectionStatus: BleConnectionStatus;
  /** Whether a paired device is cached for quick dialog-free reconnect. */
  readonly canReconnect: boolean;
  /** Latest connected BG02 device metadata & telemetry, or `null`. */
  readonly metadata: ConnectedDeviceMetadata | null;
  /** Discovery toggle enabling `acceptAllDevices: true` when UUID ads are omitted. */
  readonly acceptAllDevices: boolean;
  /** Throughput toggle favoring `writeValueWithoutResponse` + 6ms pacing. */
  readonly preferWriteWithoutResponse: boolean;
  /** Saved BG02 badges remembered locally for multi-badge switching and nicknames. */
  readonly savedDevices: ReadonlyArray<SavedBadgeProfile>;
  /** Web Bluetooth device IDs holding a live `BluetoothDevice` handle in this tab/session. */
  readonly liveDeviceIds: ReadonlyArray<string>;
  /** Currently active or target BG02 device ID, or `null`. */
  readonly activeDeviceId: string | null;
  /** User preferences governing unexpected-drop retry and startup auto-connect. */
  readonly reconnectPrefs: AutoReconnectPreferences;
  /** Live automatic reconnect progress, or `null` when idle. */
  readonly reconnectStatus: ReconnectStatus | null;
  /** Loaded image file summary, or `null` when editing background/text only. */
  readonly sourceMeta: LoadedSourceMeta | null;
  /** Current image placement/scale/rotation/background configuration. */
  readonly transform: ImageTransform;
  /** Current optional text overlay configuration (disabled by default). */
  readonly textOverlay: TextOverlayConfig;
  /** Current JPEG auto-optimization or manual quality setting. */
  readonly encoding: JpegEncodingConfig;
  /** Most recent rendered Baseline JPEG output and inspection verdict. */
  readonly latestOutput: CompositedBadgeResult | null;
  /** Active WatchTheme3 transfer progress snapshot, or `null` when idle. */
  readonly uploadProgress: UploadProgress | null;
  /** Localized upload completion banner text, or `null`. */
  readonly uploadSuccessBanner: string | null;
  /** Localized action/connection error banner text, or `null`. */
  readonly actionErrorBanner: string | null;
  /** Chronological communication and protocol log lines. */
  readonly logs: ReadonlyArray<BleLogEntry>;
  /** Whether the PWA Service Worker has registered successfully. */
  readonly serviceWorkerActive: boolean;
}

/** Subscriber callback notified synchronously on state mutations. */
export type StoreListener = (state: AppStateSnapshot) => void;

/**
 * Centralized unidirectional state container for BG02 Studio.
 */
export class AppStore {
  /** Current internal immutable state object. */
  private state: AppStateSnapshot;
  /** Active UI change subscribers. */
  private readonly listeners = new Set<StoreListener>();
  /** Monotonic log sequence counter. */
  private nextLogId = 1;
  /** Session start epoch used to format relative `h:mm:ss` timestamps matching legacy traces. */
  private readonly startEpochMs = Date.now();

  /**
   * Initializes the store with clean disconnected defaults and `autoOptimize: true`.
   */
  public constructor() {
    const savedDevices = loadSavedDeviceProfiles();
    const reconnectPrefs = loadReconnectPrefs();
    const initialActiveId =
      reconnectPrefs.lastActiveDeviceId &&
      savedDevices.some((d) => d.id === reconnectPrefs.lastActiveDeviceId)
        ? reconnectPrefs.lastActiveDeviceId
        : (savedDevices[0]?.id ?? null);

    this.state = {
      activeScreen: "home",
      detailDeviceId: initialActiveId,
      connectionStatus: "disconnected",
      canReconnect: false,
      metadata: null,
      acceptAllDevices: true,
      preferWriteWithoutResponse: false,
      savedDevices,
      liveDeviceIds: [],
      activeDeviceId: initialActiveId,
      reconnectPrefs,
      reconnectStatus: null,
      sourceMeta: null,
      transform: createDefaultTransform(),
      textOverlay: createDefaultTextOverlay(),
      encoding: createDefaultEncodingConfig(),
      latestOutput: null,
      uploadProgress: null,
      uploadSuccessBanner: null,
      actionErrorBanner: null,
      logs: [],
      serviceWorkerActive: false,
    };
  }

  /**
   * Returns the latest immutable state snapshot.
   *
   * @returns Current {@link AppStateSnapshot}.
   */
  public get snapshot(): AppStateSnapshot {
    return this.state;
  }

  /**
   * Subscribes to store state changes.
   *
   * @param listener - Function invoked whenever state changes.
   * @returns Unsubscribe function.
   */
  public subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Replaces selected top-level fields and notifies subscribers.
   *
   * @param patch - Partial snapshot properties to merge cleanly.
   */
  public patchState(patch: Partial<AppStateSnapshot>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  /**
   * Updates image placement/zoom/rotation/background fields cleanly.
   *
   * @param patch - Partial {@link ImageTransform} fields.
   */
  public updateTransform(patch: Partial<ImageTransform>): void {
    this.state = {
      ...this.state,
      transform: { ...this.state.transform, ...patch },
      uploadSuccessBanner: null,
    };
    this.emit();
  }

  /**
   * Updates optional text overlay settings.
   *
   * @param patch - Partial {@link TextOverlayConfig} fields.
   */
  public updateTextOverlay(patch: Partial<TextOverlayConfig>): void {
    this.state = {
      ...this.state,
      textOverlay: { ...this.state.textOverlay, ...patch },
      uploadSuccessBanner: null,
    };
    this.emit();
  }

  /**
   * Updates JPEG optimization mode, byte budget, or manual quality.
   *
   * @param patch - Partial {@link JpegEncodingConfig} fields.
   */
  public updateEncoding(patch: Partial<JpegEncodingConfig>): void {
    this.state = {
      ...this.state,
      encoding: { ...this.state.encoding, ...patch },
    };
    this.emit();
  }

  /**
   * Appends a timestamped communication log entry, capping history at {@link MAX_LOG_ENTRIES}.
   *
   * @param level - Severity / direction tag.
   * @param message - Log message content.
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
   * Clears all buffered communication logs.
   */
  public clearLogs(): void {
    this.state = { ...this.state, logs: [] };
    this.emit();
  }

  /**
   * Notifies all registered UI subscribers with the latest snapshot.
   */
  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
