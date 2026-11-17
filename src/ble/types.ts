/**
 * @module ble/types
 * Shared strongly typed data models for BG02 BLE connection state, device metadata,
 * frame codec output, write queue items, and dial upload progress/results.
 */

import type { DialErrorKey } from "../constants/ble";

/** Physical screen silhouette reported by the `0x20/0x02` Dial Info command. */
export type DisplayShape = "square" | "round";

/** Connection lifecycle state tracked by the BLE client and UI store. */
export type BleConnectionStatus =
  | "disconnected"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "uploading"
  | "error";

/**
 * Cause of a GATT disconnection event.
 */
export type DisconnectReason = "manual" | "unexpected";

/**
 * Progress snapshot while automatically retrying an unexpected disconnect.
 */
export interface ReconnectStatus {
  /** Current retry attempt number (1-based). */
  readonly attempt: number;
  /** Maximum automatic retry attempts before pausing. */
  readonly maxAttempts: number;
  /** Target `WebBluetoothDevice.id` being reconnected. */
  readonly targetDeviceId: string;
}

/** Severity level assigned to each chronological entry in the communication log. */
export type LogLevel = "info" | "tx" | "rx" | "warn" | "error";

/** Single communication log entry recorded by the BLE client or imaging workflow. */
export interface BleLogEntry {
  /** Monotonic sequence counter used for stable rendering keys. */
  readonly id: number;
  /** Elapsed time (`h:mm:ss`) or local timestamp formatted for readability. */
  readonly timestamp: string;
  /** Visual/semantic severity tag. */
  readonly level: LogLevel;
  /** Human-readable log message (already localized or protocol hex summary). */
  readonly message: string;
}

/**
 * Decoded `ClockDialInfoBody` payload returned by `0x20/0x02`.
 *
 * // 意図: 実機 (`LJ733_MB_V1.5 / V35922`) で観測された 240x240 round, JPEG (4), pkg=5000B 等のフィールド構造を保持する。
 */
export interface ClockDialInfo {
  /** Raw screen type byte (`0` = square, non-zero = round). */
  readonly screenType: number;
  /** Normalized display silhouette derived from `screenType`. */
  readonly shape: DisplayShape;
  /** Signed hardware grade byte. */
  readonly grade: number;
  /** Display width in pixels (e.g. `240`). */
  readonly width: number;
  /** Display height in pixels (e.g. `240`). */
  readonly height: number;
  /** MCU/platform identifier string (e.g. `"K66"`). */
  readonly mchModel: string;
  /** Main board identifier string (e.g. `"LJ733"`). */
  readonly mainModel: string;
  /** Raw config capability byte, or `null` if payload truncated before trailing metadata. */
  readonly config: number | null;
  /** Raw image compression algorithm byte (`4` = JPEG), or `null` if absent. */
  readonly algorithm: number | null;
  /** Human-readable compression format label (e.g. `"JPEG (4)"`). */
  readonly algorithmName: string;
  /** Encoded version check value (`0` if checksum byte matches `b0 - b1`), or `null`. */
  readonly versionCode: number | null;
  /** OEM customer identifier string (e.g. `"JQ001"`). */
  readonly customer: string;
  /** Number of stored custom pictures reported by firmware, or `null` if unavailable. */
  readonly pictureNums: number | null;
  /** WatchTheme protocol version number (e.g. `9`), or `null` if unavailable. */
  readonly watchThemeVersion: number | null;
  /** Maximum chunk payload length (bytes) accepted per `0x1F/0x01` frame (defaults to `5000`). */
  readonly watchThemeShortPkgLength: number;
  /** Expected thumbnail width in pixels, or `null` if omitted by firmware. */
  readonly thumbWidth: number | null;
  /** Expected thumbnail height in pixels, or `null` if omitted by firmware. */
  readonly thumbHeight: number | null;
}

/** Standard BLE GATT attributes read from Battery Service (`0x180F`) and DIS (`0x180A`). */
export interface StandardDeviceInfo {
  /** Current battery charge percentage (`0`..`100`), if readable. */
  readonly batteryPercent?: number;
  /** Manufacturer name string (`0x2A29`). */
  readonly manufacturer?: string;
  /** Model number string (`0x2A24`). */
  readonly model?: string;
  /** Firmware revision string (`0x2A26`). */
  readonly firmwareRevision?: string;
  /** Hardware revision string (`0x2A27`). */
  readonly hardwareRevision?: string;
  /** Software revision string (`0x2A28`). */
  readonly softwareRevision?: string;
}

/** Combined device summary populated after connecting or querying device telemetry. */
export interface ConnectedDeviceMetadata {
  /** Browser-scoped Web Bluetooth device identifier. */
  readonly deviceId: string;
  /** Advertised device name (e.g. `"BG02"`). */
  readonly deviceName: string;
  /** Capabilities supported by the discovered TX write characteristic. */
  readonly writeCapabilities: {
    /** Whether reliable Write With Response is supported. */
    readonly write: boolean;
    /** Whether Write Without Response is supported. */
    readonly writeWithoutResponse: boolean;
  };
  /** Number of active notification characteristics subscribed (typically `2`). */
  readonly notifyCount: number;
  /** Latest dial geometry info (`0x20/0x02`), or `null` if not queried / timed out. */
  readonly dialInfo: ClockDialInfo | null;
  /** Latest available flash storage in bytes (`0x20/0x04`), or `null` if unavailable. */
  readonly freeStorageBytes: number | null;
  /** Optional error reason string when querying `0x20/0x04` failed. */
  readonly freeStorageError: string | null;
  /** Standard Battery / DIS values, or `null` if not yet read. */
  readonly standardInfo: StandardDeviceInfo | null;
}

/** Parsed incoming `0xCD` protocol data frame extracted from BLE notifications. */
export interface ParsedRxFrame {
  /** Full byte length of the raw `0xCD` frame (used inside the mandatory `0xDC` ACK reply). */
  readonly frameLength: number;
  /** Module identifier (`frame[3]`, e.g. `0x20`). */
  readonly cmdId: number;
  /** Sub-command identifier (`frame[5]`, e.g. `0x01`, `0x02`, `0x04`). */
  readonly cmdKey: number;
  /** Frame payload slice starting at byte offset `8`. */
  readonly payload: Uint8Array;
}

/** Result returned by `consumeNotifyChunk()` after appending a raw BLE notification packet. */
export interface NotifyStreamResult {
  /** Leading `0xDC` ACK packet(s) received from the device when idle. */
  readonly ackPackets: ReadonlyArray<Uint8Array>;
  /** Complete `0xCD` command/data frames parsed from the buffered stream. */
  readonly frames: ReadonlyArray<ParsedRxFrame>;
  /** Remaining partial bytes awaiting subsequent BLE notification packets. */
  readonly nextBuffer: Uint8Array;
}

/** Options controlling BLE device discovery and connection behavior. */
export interface ConnectOptions {
  /** Show all BLE peripherals in browser chooser (recommended when BG02 omits service UUID in ads). */
  readonly acceptAllDevices?: boolean;
  /** Optional device name prefix filter (ignored when `acceptAllDevices` is `true`). */
  readonly namePrefix?: string;
  /** Reuse a cached `BluetoothDevice` instance without opening the chooser dialog. */
  readonly reuseDevice?: boolean;
  /** Specific `WebBluetoothDevice.id` to target when `reuseDevice` is `true`. */
  readonly deviceId?: string;
  /** Prefer `writeValueWithoutResponse` over `writeValueWithResponse` during writes. */
  readonly preferWriteWithoutResponse?: boolean;
}

/** Parameters accepted by `WatchTheme3` Start frame builder (`0x1F/0x02`). */
export interface DialStartOptions {
  /** Watch face slot identifier (`5538` / `0x15A2` verified on BG02). */
  readonly watchId: number;
  /** Encoded payload type (`2` = JPEG). */
  readonly fileType: number;
  /** Total length of `[uint32_be(imgLen), ...imgBytes]`. */
  readonly wrappedLength: number;
  /** Feature bitmask (`0x08` = background image slot). */
  readonly cfgMask: number;
}

/** Transfer stage indicator emitted alongside normalized chunk progress. */
export type UploadStage = "start" | "transferring" | "awaiting_finish";

/** Options passed when uploading a custom JPEG image via `WatchTheme3`. */
export interface UploadDialOptions {
  /** Watch face identifier written into the Start frame (defaults to `5538`). */
  readonly watchId?: number;
  /** File type flag written into the Start frame (defaults to `2` for JPEG). */
  readonly fileType?: number;
  /** Override chunk size in bytes (defaults to device-reported `watchThemeShortPkgLength` or `5000`). */
  readonly chunkSize?: number;
  /** Expected connected `device.id`; upload refuses to write if active session differs. */
  readonly expectedDeviceId?: string;
  /** Progress callback receiving normalized ratio `[0, 1]`, bytes, and transfer stage. */
  readonly onProgress?: (progress: UploadProgress) => void;
}

/** Real-time progress snapshot emitted during a WatchTheme3 image upload. */
export interface UploadProgress {
  /** Normalized completion fraction in `[0, 1]`. */
  readonly ratio: number;
  /** Number of wrapped payload bytes sent so far. */
  readonly sentBytes: number;
  /** Total wrapped payload byte count (`imageBytes.length + 4`). */
  readonly totalBytes: number;
  /** Current 1-based WatchTheme3 chunk sequence index (`0` during Start handshake). */
  readonly currentChunk: number;
  /** Total WatchTheme3 chunk count. */
  readonly totalChunks: number;
  /** Optional explicit protocol stage distinguishing chunk TX from post-chunk completion wait. */
  readonly stage?: UploadStage;
}

/** Final verification summary resolved upon successful WatchTheme3 upload completion (`code === 2`). */
export interface UploadDialResult {
  /** Connected `device.id` that confirmed `FINISH_OK` (`code === 2`). */
  readonly deviceId: string;
  /** Raw JPEG byte length before WatchTheme3 4-byte length header wrapping. */
  readonly imageBytes: number;
  /** Total WatchTheme3 payload byte length (`imageBytes + 4`). */
  readonly payloadBytes: number;
  /** Unsigned 32-bit byte sum checksum verified by BG02 during Finish (`0x1F/0x03`). */
  readonly totalChecksum: number;
  /** Total elapsed upload duration in milliseconds. */
  readonly elapsedMs: number;
}

/** Options controlling how a frame or ACK is placed onto the serialized GATT write queue. */
export interface WriteQueueOptions {
  /** Place short priority packets (`<= 20B`, such as `0xDC` ACKs) ahead of pending data writes. */
  readonly priority?: boolean;
  /** Optional settle pause in milliseconds after all 20B segments finish writing. */
  readonly delayAfterMs?: number;
  /** Optional compact log label (omitted for high-frequency data chunks to avoid log flooding). */
  readonly label?: string;
}

/**
 * Typed protocol error carrying a known BG02 firmware error code or i18n diagnostic hint.
 */
export class Bg02ProtocolError extends Error {
  /** Numeric firmware status code if returned by `0x20/0x01`, otherwise `undefined`. */
  public readonly statusCode?: number;
  /** Semantic translation key for localized error presentation, if matched. */
  public readonly errorKey?: DialErrorKey;

  /**
   * Constructs a structured BG02 protocol error.
   *
   * @param message - Diagnostic fallback message in English/technical form.
   * @param statusCode - Optional numeric code reported by the badge firmware.
   * @param errorKey - Optional localization key mapped from `DIAL_ERROR_KEY_MAP`.
   */
  public constructor(message: string, statusCode?: number, errorKey?: DialErrorKey) {
    super(message);
    this.name = "Bg02ProtocolError";
    this.statusCode = statusCode;
    this.errorKey = errorKey;
  }
}

/** Categorized Web Bluetooth connection failure causes surfaced for UI recovery actions. */
export type Bg02ConnectFailureReason = "permission_unavailable" | "gatt_failed" | "unsupported";

/**
 * Typed connection error carrying a structured failure reason so the UI can distinguish
 * missing browser permission (open chooser) from RF/GATT failure (check power & range).
 */
export class Bg02ConnectError extends Error {
  /** Failure category used by Send/Detail panels to render targeted recovery controls. */
  public readonly reason: Bg02ConnectFailureReason;
  /** Identifier of the selected/cached Bluetooth device whose connection failed, when known. */
  public readonly deviceId?: string;
  /** Advertised device name of the selected/cached Bluetooth device, when known. */
  public readonly deviceName?: string;

  /**
   * Constructs a categorized BG02 connection error.
   *
   * @param reason - Structured failure cause (`"permission_unavailable"`, `"gatt_failed"`, or `"unsupported"`).
   * @param message - Diagnostic fallback message describing the failure.
   * @param device - Optional identity metadata captured after a device was chosen or reused.
   */
  public constructor(
    reason: Bg02ConnectFailureReason,
    message: string,
    device?: { readonly id?: string; readonly name?: string }
  ) {
    super(message);
    this.name = "Bg02ConnectError";
    this.reason = reason;
    this.deviceId = device?.id;
    this.deviceName = device?.name;
  }
}

/**
 * Returns `true` when an upload failure is transient (timeout or BLE drop) rather than
 * an explicit BG02 firmware rejection code (`statusCode` reported by `0x20/0x01`).
 *
 * // 意図: バッテリー 20% 未満 (コード 3)・充電中拒否 (コード 4)・容量不足 (コード 5) などの端末側拒否応答は
 * //       自動再送しても解消しないため即停止し、95% 付近でのタイムアウトや一時的な切断のみ再送信対象とする。
 *
 * @param err - Caught error raised during an upload attempt.
 * @returns `true` if automatic re-transmission may succeed.
 */
export function isRetryableUploadError(err: unknown): boolean {
  if (err instanceof Bg02ProtocolError && err.statusCode !== undefined) {
    return false;
  }
  return true;
}
