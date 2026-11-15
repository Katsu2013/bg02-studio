/**
 * @module constants/ble
 * BLE service UUIDs, protocol framing bytes, timing constants, and WatchTheme3 defaults
 * verified against the BG02 (LJ733 / E-BADGE) firmware (`V35922`, `WatchThemeVersion=9`).
 */

/** Primary GATT service UUID for the BG02 `mywatchsdklib` vendor profile (Nordic UART variant). */
export const MYWATCH_SERVICE_UUID = "7e400001-b5a3-f393-e0a9-e50e24dcca9d";

/** Write characteristic UUID (`write` and `writeWithoutResponse`) for commands and image chunks. */
export const MYWATCH_WRITE_UUID = "7e400002-b5a3-f393-e0a9-e50e24dcca9d";

/** Primary notification characteristic UUID used for command responses and ACKs. */
export const MYWATCH_NOTIFY1_UUID = "7e400003-b5a3-f393-e0a9-e50e24dcca9d";

/**
 * Secondary notification characteristic UUID exposed by some BG02 firmware builds.
 *
 * // 意図: APK 解析 (bluetooth/c.java) に従い、端末側がいずれか片方または両方で通知を返す可能性があるため、存在するものは両方購読する。
 */
export const MYWATCH_NOTIFY2_UUID = "7e400004-b5a3-f393-e0a9-e50e24dcca9d";

/** Standard Bluetooth SIG GATT service identifiers requested in `optionalServices`. */
export const STANDARD_SERVICES = {
  /** Device Information Service (0x180A) exposing firmware/hardware revisions. */
  DEVICE_INFO: 0x180a,
  /** Battery Service (0x180F) exposing current badge charge level. */
  BATTERY: 0x180f,
} as const;

/** Standard Bluetooth SIG characteristic UUIDs read from Battery & Device Information Services. */
export const STANDARD_CHARACTERISTICS = {
  /** Battery Level (uint8 percentage). */
  BATTERY_LEVEL: "00002a19-0000-1000-8000-00805f9b34fb",
  /** Manufacturer Name String (UTF-8). */
  MANUFACTURER_NAME: "00002a29-0000-1000-8000-00805f9b34fb",
  /** Model Number String (UTF-8). */
  MODEL_NUMBER: "00002a24-0000-1000-8000-00805f9b34fb",
  /** Firmware Revision String (UTF-8). */
  FIRMWARE_REVISION: "00002a26-0000-1000-8000-00805f9b34fb",
  /** Hardware Revision String (UTF-8). */
  HARDWARE_REVISION: "00002a27-0000-1000-8000-00805f9b34fb",
  /** Software Revision String (UTF-8). */
  SOFTWARE_REVISION: "00002a28-0000-1000-8000-00805f9b34fb",
} as const;

/**
 * Maximum byte size of a single GATT characteristic write operation.
 *
 * // 意図: BLE 既定 ATT MTU (23B - ATTヘッダ3B = 20B) を超えない分割長に揃えることで、OS/チップセット間の MTU ネゴシエーション差異による欠損を防ぐ。
 */
export const GATT_CHUNK_SIZE = 20;

/** Leading delimiter byte (`0xCD`) for all command and response data frames. */
export const FRAME_START_BYTE = 0xcd;

/** Leading delimiter byte (`0xDC`) for 8-byte transport-layer acknowledgment frames. */
export const ACK_START_BYTE = 0xdc;

/** Maximum allowed total RX frame length (bytes) when reassembling notification streams. */
export const MAX_RX_FRAME_BYTES = 4096;

/** Maximum connection attempts per `connect()` invocation (guards initial Windows BLE drop). */
export const GATT_CONNECT_MAX_ATTEMPTS = 2;

/** Delay in milliseconds before retrying a dropped initial GATT connection attempt. */
export const GATT_CONNECT_RETRY_DELAY_MS = 500;

/** Post-write pacing delay (ms) after the mandatory `Lqm2.r` pairing frame. */
export const PAIR_WRITE_DELAY_MS = 20;

/** Default post-write delay (ms) after standard control commands and ACKs. */
export const COMMAND_WRITE_DELAY_MS = 10;

/**
 * Post-write pacing delay (ms) after sending each WatchTheme3 dial chunk or finish frame.
 *
 * // 意図: 5000B 前後のチャンクを 20B 分割で連続送信する際、端末側受信バッファ溢れを起こさず応答を待つための小休止。
 */
export const DIAL_CHUNK_WRITE_DELAY_MS = 6;

/**
 * Extra pacing delay (ms) after each `writeValueWithoutResponse` 20B packet.
 *
 * // 意図: WriteWithoutResponse 経路では GATT レベルのフロー制御が無いため、6ms 間隔でペーシングしないとパケットロストが起きやすい。
 */
export const WRITE_WITHOUT_RESPONSE_PACING_MS = 6;

/** Default timeout (ms) when querying dial geometry info (`0x20/0x02`). */
export const DIAL_INFO_TIMEOUT_MS = 5000;

/** Default timeout (ms) when querying available flash storage (`0x20/0x04`). */
export const FREE_STORAGE_TIMEOUT_MS = 5000;

/**
 * Maximum wait (ms) for BG02 response after a WatchTheme3 packet finishes draining from the TX queue.
 *
 * // 意図: Start(17B)/Chunk(~5000B) が 20B ずつ分割送信されるため、送信完了前にタイマーを開始すると誤タイムアウトになる。必ず enqueueWrite 完了後に開始する。
 */
export const DIAL_STEP_RESPONSE_TIMEOUT_MS = 15000;

/** Maximum retry count for a single timed-out WatchTheme3 chunk packet. */
export const DIAL_MAX_CHUNK_RETRIES = 3;

/**
 * Wait timeout (ms) per `DIAL_FINISH` (`0x1F/0x03`) attempt before polling `0x20/0x01`
 * and resending the finish frame when completion stalls near 95%.
 *
 * // 意図: 完了通知待ち（95%）で 15 秒×3 回（45 秒）待ってから全体再送へ移ると体感が長すぎるため、
 * //       APK (`Lgh3`) の 5 秒ポーリング周期に寄せた 6 秒間隔で状態確認＋完了フレーム再送を行う。
 */
export const DIAL_FINISH_STEP_TIMEOUT_MS = 6000;

/** Maximum retries of `DIAL_FINISH` (`0x1F/0x03`) within a single transfer session. */
export const DIAL_MAX_FINISH_RETRIES = 2;

/**
 * Maximum automatic full re-upload retries in the app workflow when a transfer stalls
 * (e.g. Finish/Chunk ACK timeout at 95%) or drops mid-transfer.
 *
 * // 意図: 95% 付近での無応答ハングは完了フレーム再送でも抜けない場合に先頭からの再送・再接続で復旧できるため、
 * //       端末側の明示拒否エラー (コード 1, 3..9) を除き最大 2 回まで自動再送信する。
 */
export const UPLOAD_MAX_AUTO_RETRIES = 2;

/** Short settle delay (ms) before starting an automatic full re-upload retry. */
export const UPLOAD_RETRY_SETTLE_DELAY_MS = 500;

/**
 * Background interval (ms) for refreshing connected badge battery and free storage while idle.
 *
 * // 意図: 充電状態や 20% 境界の変化・空き容量を画面に最新反映するため、転送中でない接続中に 30 秒周期で再取得する。
 */
export const TELEMETRY_POLL_INTERVAL_MS = 30_000;

/**
 * Default watch face identifier passed in `WatchTheme3` Start payloads (`0x000015A2`).
 *
 * // 意図: 実機検証にて既定文字盤スロット上書き用として受理された WatchTheme3Tools (Lgh3.Q) の固定テスト ID。
 */
export const DEFAULT_WATCH_ID = 5538;

/** File type indicator `2` representing JPEG in `WatchTheme3` Start frames (`0x1F/0x02`). */
export const DIAL_FILE_TYPE_JPEG = 2;

/**
 * Configuration bitmask `0x08` indicating a background image slot in `WatchTheme3`.
 *
 * // 意図: APK (Lgh3.Q) における bgBinPath 単体転送フラグ。時計針・ウィジェット構成データを伴わない画像単体更新を示す。
 */
export const DIAL_CFG_MASK_BG_ONLY = 0x08;

/** Fallback chunk size (bytes) when `dialInfo.watchThemeShortPkgLength` has not been queried yet. */
export const DEFAULT_DIAL_CHUNK_BYTES = 5000;

/** Fallback target canvas width/height (px) for the BG02 circular display. */
export const DEFAULT_DISPLAY_SIZE_PX = 240;

/**
 * Recommended maximum JPEG payload size (15 KiB) balancing fast BLE throughput and visual clarity.
 *
 * // 意図: 実機フラッシュ書き込みと 20B チャンク転送時間を実用域（数秒以内）に収めつつ、240×240 円形表示で十分な画質を保つ目安。
 */
export const RECOMMENDED_JPEG_MAX_BYTES = 15 * 1024;

/** Protocol module identifiers (`cmdId`, frame byte index 3). */
export const BLE_MODULE = {
  /** Pairing & system control module (`0x12`). */
  SYSTEM: 0x12,
  /** WatchTheme3 upload data transfer module (`0x1F`). */
  DIAL_TRANSFER: 0x1f,
  /** WatchTheme3 metadata & status response module (`0x20`). */
  DIAL_CONTROL: 0x20,
} as const;

/** Protocol sub-command identifiers (`subCmd` / `cmdKey`, frame byte index 5). */
export const BLE_SUB_CMD = {
  /** Mandatory pairing handshake (`0x12/0x0A`, value `0x02` = `Lqm2.r`). */
  PAIR: 0x0a,
  /** WatchTheme3 response code notification (`0x20/0x01`). */
  DIAL_RESPONSE: 0x01,
  /** Query display dimensions and encoding info (`0x20/0x02`). */
  GET_DIAL_INFO: 0x02,
  /** Query free storage capacity in bytes (`0x20/0x04`). */
  GET_FREE_STORAGE: 0x04,
  /** Send WatchTheme3 data chunk (`0x1F/0x01`). */
  DIAL_CHUNK: 0x01,
  /** Send WatchTheme3 start metadata (`0x1F/0x02`). */
  DIAL_START: 0x02,
  /** Send WatchTheme3 finish & checksum verification (`0x1F/0x03`). */
  DIAL_FINISH: 0x03,
} as const;

/** Mandatory `Lqm2.r` pairing command payload byte (`0x02`). */
export const PAIR_HANDSHAKE_VALUE = 0x02;

/** Known numeric status codes returned by BG02 inside `0x20/0x01` notifications. */
export const DIAL_STATUS = {
  /** Upload finalized successfully on device (`code === 2`). */
  FINISH_OK: 2,
  /** Base offset for chunk/start acknowledgments (`1000` = start ACK, `1000 + seq` = chunk `seq` ACK). */
  SEQ_ACK_BASE: 1000,
} as const;

/**
 * Semantic i18n keys for WatchTheme3 / firmware upgrade failure codes (1..9).
 *
 * // 意図: 公式コンパニオン APK (`WatchTheme3Tools` / `Lgh3.N` および `WatchThemeTransferManager.K`) の
 * //       1..9 -> 1003〜1015 変換表と `resources.arsc` 文言に厳密一致させてマップする。
 */
export type DialErrorKey =
  | "checksumMismatch"
  | "lowBattery"
  | "deviceCharging"
  | "storageFull"
  | "themeLimitExceeded"
  | "duplicateUpgrade"
  | "themeIdNotFound"
  | "upgradeTooFrequent";

/** Lookup table mapping BG02 `0x20/0x01` failure codes to typed translation keys. */
export const DIAL_ERROR_KEY_MAP: Readonly<Record<number, DialErrorKey>> = {
  1: "checksumMismatch",
  3: "lowBattery",
  4: "deviceCharging",
  5: "storageFull",
  6: "themeLimitExceeded",
  7: "duplicateUpgrade",
  8: "themeIdNotFound",
  9: "upgradeTooFrequent",
};

/** Compression algorithm display names keyed by firmware algorithm byte from `0x20/0x02`. */
export const ALGORITHM_NAMES: Readonly<Record<number, string>> = {
  0: "JieLi BMP (0)",
  3: "JieLi BMP (3)",
  4: "JPEG (4)",
};
