/**
 * @module ble/bg02Client
 * High-level Web Bluetooth client managing BG02 discovery, GATT retry connection,
 * mandatory `Lqm2.r` handshake, frame matching, device metadata queries, and `WatchTheme3` image uploads.
 */

import {
  BLE_MODULE,
  BLE_SUB_CMD,
  COMMAND_WRITE_DELAY_MS,
  DEFAULT_DIAL_CHUNK_BYTES,
  DEFAULT_WATCH_ID,
  DIAL_CFG_MASK_BG_ONLY,
  DIAL_CHUNK_WRITE_DELAY_MS,
  DIAL_ERROR_KEY_MAP,
  DIAL_FILE_TYPE_JPEG,
  DIAL_FINISH_STEP_TIMEOUT_MS,
  DIAL_INFO_TIMEOUT_MS,
  DIAL_MAX_CHUNK_RETRIES,
  DIAL_MAX_FINISH_RETRIES,
  DIAL_STATUS,
  DIAL_STEP_RESPONSE_TIMEOUT_MS,
  FREE_STORAGE_TIMEOUT_MS,
  GATT_CONNECT_MAX_ATTEMPTS,
  GATT_CONNECT_RETRY_DELAY_MS,
  MYWATCH_NOTIFY1_UUID,
  MYWATCH_NOTIFY2_UUID,
  MYWATCH_SERVICE_UUID,
  MYWATCH_WRITE_UUID,
  PAIR_WRITE_DELAY_MS,
  STANDARD_CHARACTERISTICS,
  STANDARD_SERVICES,
} from "../constants/ble";
import {
  buildDialChunkFrame,
  buildDialFinishFrame,
  buildDialStartFrame,
  buildGetDialInfoFrame,
  buildGetFreeStorageFrame,
  buildPairFrame,
  buildReadDialStatusFrame,
  byteSum32,
  consumeNotifyChunk,
  encodeAck,
  parseClockDialInfo,
  parseFreeStorageBytes,
  toHexPreview,
  wrapDialPayload,
} from "./frameCodec";
import {
  Bg02ProtocolError,
  type ClockDialInfo,
  type ConnectedDeviceMetadata,
  type ConnectOptions,
  type DisconnectReason,
  type ParsedRxFrame,
  type StandardDeviceInfo,
  type UploadDialOptions,
  type UploadDialResult,
} from "./types";
import type {
  WebBluetoothApi,
  WebBluetoothCharacteristic,
  WebBluetoothDevice,
  WebBluetoothGattServer,
  WebBluetoothRequestDeviceOptions,
  WebBluetoothService,
  WebBluetoothValueChangedEvent,
} from "./webBluetooth.types";
import { BleWriteQueue, sleepMs, type QueueLogger } from "./writeQueue";

/** Internal pending promise entry awaiting a specific incoming `0xCD` command frame. */
export interface PendingFrameWaiter {
  /** Predicate inspecting command ID, sub-command key, and payload bytes. */
  readonly match: (cmdId: number, cmdKey: number, payload: Uint8Array) => boolean;
  /** Fulfillment callback receiving the matched frame. */
  readonly resolve: (frame: ParsedRxFrame) => void;
  /** Rejection callback triggered on timeout or unexpected disconnect. */
  readonly reject: (reason: unknown) => void;
  /** Active timeout timer identifier cleared upon match or teardown. */
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Callback invoked when the active BG02 GATT server disconnects manually or unexpectedly.
 *
 * @param reason - Distinguishes user-initiated teardown from unexpected RF/battery drops.
 * @param deviceId - Web Bluetooth identifier of the disconnected badge.
 */
export type DisconnectListener = (reason: DisconnectReason, deviceId: string) => void;

/** Shared UTF-8 decoder for reading Device Information Service (DIS) strings. */
const disDecoder = new TextDecoder();

/**
 * Stateful Web Bluetooth client communicating with BG02 (`mywatchsdklib`) badges.
 *
 * // 意図: セッション断・再接続時の二重リスナー登録や TX/RX 競合を防ぐため、
 * WeakSet 管理と直列書込キューを内包した状態機械として実装する。
 */
export class Bg02Client {
  /** Callback receiving chronological diagnostic logs. */
  private readonly logger: QueueLogger;
  /** Serialized GATT TX queue preventing overlapping Web Bluetooth writes. */
  private readonly writeQueue: BleWriteQueue;
  /** Live `BluetoothDevice` handles indexed by `device.id` for dialog-free switching/reconnect. */
  private readonly deviceCache = new Map<string, WebBluetoothDevice>();
  /** Identifier of the currently active/selected device inside {@link deviceCache}. */
  private activeDeviceId: string | null = null;
  /** Device IDs whose current `gatt.disconnect()` was initiated explicitly by user `disconnect()`. */
  private readonly expectedDisconnectIds = new Set<string>();
  /** Device IDs torn down internally during a seamless device switch (`connect()`), suppressing UI disconnect callbacks. */
  private readonly suppressedDisconnectIds = new Set<string>();
  /** Active GATT server connection when linked. */
  private server: WebBluetoothGattServer | null = null;
  /** Active TX characteristic (`7e400002`). */
  private writeChar: WebBluetoothCharacteristic | null = null;
  /** Subscribed RX notification characteristics (`7e400003` and optional `7e400004`). */
  private notifyChars: WebBluetoothCharacteristic[] = [];
  /** Partial notification reassembly buffer across 20B BLE packets. */
  private rxBuffer = new Uint8Array(0);
  /** Pending synchronous command waiters awaiting response frames. */
  private readonly waiters: PendingFrameWaiter[] = [];
  /** Active `WatchTheme3` response code (`0x20/0x01`) observer during dial upload. */
  private dialResponseHandler: ((code: number) => void) | null = null;
  /** WeakSet preventing duplicate `gattserverdisconnected` listeners on cached devices. */
  private readonly boundDisconnectDevices = new WeakSet<WebBluetoothDevice>();
  /** WeakSet preventing duplicate `characteristicvaluechanged` listeners across reconnects. */
  private readonly boundNotifyChars = new WeakSet<WebBluetoothCharacteristic>();
  /** Preferred GATT write mode flag (`true` favors `writeValueWithoutResponse`). */
  private preferWriteWithoutResponse = false;
  /** Cached dial geometry retrieved during the active session. */
  private lastDialInfo: ClockDialInfo | null = null;
  /** Optional disconnect observer triggered when remote GATT connection drops. */
  private onDisconnectCallback: DisconnectListener | null = null;

  /**
   * Constructs a new {@link Bg02Client}.
   *
   * @param logger - Callback receiving protocol TX/RX and connection status logs.
   */
  public constructor(logger: QueueLogger = () => undefined) {
    this.logger = logger;
    this.writeQueue = new BleWriteQueue(
      () => (this.isConnected ? this.writeChar : null),
      () => this.preferWriteWithoutResponse,
      logger
    );
  }

  /**
   * Resolves the currently active {@link WebBluetoothDevice} handle from {@link deviceCache}.
   *
   * @returns Active device handle or `null`.
   */
  private get device(): WebBluetoothDevice | null {
    return this.activeDeviceId ? (this.deviceCache.get(this.activeDeviceId) ?? null) : null;
  }

  /**
   * Registers a callback notified whenever the active GATT link disconnects.
   *
   * @param listener - Callback or `null` to detach.
   */
  public setOnDisconnect(listener: DisconnectListener | null): void {
    this.onDisconnectCallback = listener;
  }

  /**
   * Queries `navigator.bluetooth.getDevices()` when supported and caches permitted device handles
   * so previously paired BG02 badges can auto-reconnect without reopening the browser picker.
   *
   * @returns List of live `device.id` values currently available in {@link deviceCache}.
   */
  public async refreshPermittedDevices(): Promise<ReadonlyArray<string>> {
    const bluetooth = typeof navigator !== "undefined" ? navigator.bluetooth : undefined;
    if (!bluetooth || typeof bluetooth.getDevices !== "function") {
      return this.getLiveDeviceIds();
    }
    try {
      const devices = await bluetooth.getDevices();
      for (const dev of devices) {
        this.deviceCache.set(dev.id, dev);
        this.attachDisconnectHandler(dev);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger("warn", `getDevices() skipped: ${reason}`);
    }
    return this.getLiveDeviceIds();
  }

  /**
   * Returns all `device.id` values that currently have a live {@link WebBluetoothDevice} handle.
   *
   * @returns Array of cached Web Bluetooth device IDs.
   */
  public getLiveDeviceIds(): ReadonlyArray<string> {
    return Array.from(this.deviceCache.keys());
  }

  /**
   * Checks whether the specified device has a live handle usable with `reuseDevice: true`.
   *
   * @param deviceId - Saved device identifier to test.
   * @returns `true` if directly reconnectable without opening `requestDevice()`.
   */
  public hasLiveDevice(deviceId: string): boolean {
    return this.deviceCache.has(deviceId);
  }

  /**
   * Removes a cached handle and, when supported by the browser, invokes `device.forget()`
   * to revoke site-level Bluetooth permission cleanly.
   *
   * @param deviceId - Identifier of the device to forget.
   * @returns `true` if `device.forget()` was natively supported and completed, `false` if only local caches cleared.
   */
  public async forgetCachedDevice(deviceId: string): Promise<boolean> {
    const cached = this.deviceCache.get(deviceId);
    let browserPermissionRevoked = false;
    if (cached && typeof cached.forget === "function") {
      try {
        await cached.forget();
        browserPermissionRevoked = true;
        this.logger("info", `Revoked browser Bluetooth permission via device.forget() for id=${deviceId}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger("warn", `device.forget() failed or canceled for id=${deviceId}: ${msg}`);
      }
    }
    this.deviceCache.delete(deviceId);
    this.expectedDisconnectIds.delete(deviceId);
    this.suppressedDisconnectIds.delete(deviceId);
    if (this.activeDeviceId === deviceId) {
      this.activeDeviceId = null;
      this.lastDialInfo = null;
    }
    return browserPermissionRevoked;
  }

  /**
   * Returns the identifier of the currently active/selected BG02 badge, or `null`.
   *
   * @returns Active `device.id` or `null`.
   */
  public get activeId(): string | null {
    return this.activeDeviceId;
  }

  /**
   * Indicates whether the GATT server and TX characteristic are currently connected.
   *
   * @returns `true` if commands and dial chunks can be written immediately.
   */
  public get isConnected(): boolean {
    return Boolean(this.server && this.server.connected && this.writeChar);
  }

  /**
   * Indicates whether a previously paired device reference is retained for dialog-free reconnect.
   *
   * @returns `true` if `connect({ reuseDevice: true })` can attempt reconnect directly.
   */
  public get canReconnect(): boolean {
    return this.device !== null;
  }

  /**
   * Returns the display name of the currently selected Bluetooth device, if any.
   *
   * @returns Advertised GAP name or empty string.
   */
  public get selectedDeviceName(): string {
    return this.device?.name ?? "";
  }

  /**
   * Returns the latest queried `ClockDialInfo`, or `null` if not yet fetched.
   *
   * @returns Cached dial geometry snapshot.
   */
  public get cachedDialInfo(): ClockDialInfo | null {
    return this.lastDialInfo;
  }

  /**
   * Connects (or reconnects) to a BG02 badge, subscribes to notification channels,
   * and transmits the mandatory `Lqm2.r` pairing handshake.
   *
   * @param options - Discovery filtering, reuse mode, and GATT write mode flags.
   * @returns Initial connection metadata snapshot before optional telemetry queries.
   * @throws {Error} When Web Bluetooth is unavailable, selection cancels, or GATT fails after retries.
   */
  public async connect(options: ConnectOptions = {}): Promise<ConnectedDeviceMetadata> {
    const bluetooth = this.requireWebBluetooth();
    const {
      acceptAllDevices = true,
      namePrefix = "",
      reuseDevice = false,
      deviceId,
      preferWriteWithoutResponse = false,
    } = options;
    this.preferWriteWithoutResponse = preferWriteWithoutResponse;

    const prevDeviceId = this.activeDeviceId;
    let targetDevice: WebBluetoothDevice;

    if (reuseDevice) {
      const lookupId = deviceId ?? this.activeDeviceId;
      const cached = lookupId ? this.deviceCache.get(lookupId) : undefined;
      if (!cached) {
        throw new Error(
          "No live Bluetooth handle is cached for this badge yet; select it via chooser first."
        );
      }
      targetDevice = cached;
      this.logger(
        "info",
        `Connecting directly to "${targetDevice.name || "(unnamed)"}" (${targetDevice.id})...`
      );
      await this.cleanDisconnect(false, true);
    } else {
      const requestOptions: WebBluetoothRequestDeviceOptions = {
        optionalServices: [
          MYWATCH_SERVICE_UUID,
          STANDARD_SERVICES.DEVICE_INFO,
          STANDARD_SERVICES.BATTERY,
        ],
        ...(namePrefix
          ? { filters: [{ namePrefix }] }
          : acceptAllDevices
            ? { acceptAllDevices: true }
            : { filters: [{ services: [MYWATCH_SERVICE_UUID] }] }),
      };

      this.logger("info", "Opening Web Bluetooth device chooser...");
      // 意図: ピッカーでユーザーがキャンセルした場合に既存接続を失わないよう、選択完了後に旧セッションを閉じる。
      targetDevice = await bluetooth.requestDevice(requestOptions);
      this.logger(
        "info",
        `Selected device: name="${targetDevice.name || "(unnamed)"}" id=${targetDevice.id}`
      );
      await this.cleanDisconnect(false, true);
      this.deviceCache.set(targetDevice.id, targetDevice);
      this.attachDisconnectHandler(targetDevice);
    }

    if (prevDeviceId !== targetDevice.id) {
      this.lastDialInfo = null;
    }
    this.activeDeviceId = targetDevice.id;
    this.expectedDisconnectIds.delete(targetDevice.id);

    if (!targetDevice.gatt) {
      throw new Error("Selected Bluetooth device does not expose a GATT server.");
    }

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= GATT_CONNECT_MAX_ATTEMPTS; attempt++) {
      try {
        // 意図: Windows / Chrome 環境では初回サービス探索時に一過性切断が起きやすいため 1 回リトライを行う。
        this.logger("info", `GATT connection attempt (${attempt}/${GATT_CONNECT_MAX_ATTEMPTS})...`);
        const connectedServer = await targetDevice.gatt.connect();
        this.suppressedDisconnectIds.delete(targetDevice.id);
        this.server = connectedServer;
        await this.discoverAndSubscribe(connectedServer);
        break;
      } catch (err) {
        lastError = err;
        const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        this.logger("warn", `Connection attempt ${attempt} failed: ${reason}`);
        this.server = null;
        this.resetSessionState();
        if (attempt < GATT_CONNECT_MAX_ATTEMPTS) {
          await sleepMs(GATT_CONNECT_RETRY_DELAY_MS);
        }
      }
    }

    if (!this.isConnected || !this.writeChar) {
      if (lastError instanceof Error) {
        throw lastError;
      }
      throw new Error("Failed to connect to BG02 GATT service (7e400001).");
    }

    // 意図: 実機は接続確立直後に Lqm2.r ペアリングフレームを受信するまでコマンド応答を返さない。
    const pairFrame = buildPairFrame();
    await this.writeQueue.enqueue(pairFrame, {
      delayAfterMs: PAIR_WRITE_DELAY_MS,
      label: "PAIR (Lqm2.r)",
    });

    return {
      deviceId: targetDevice.id,
      deviceName: targetDevice.name ?? "",
      writeCapabilities: {
        write: this.writeChar.properties.write,
        writeWithoutResponse: this.writeChar.properties.writeWithoutResponse,
      },
      notifyCount: this.notifyChars.length,
      dialInfo: this.lastDialInfo,
      freeStorageBytes: null,
      freeStorageError: null,
      standardInfo: null,
    };
  }

  /**
   * Disconnects the active GATT session while retaining the device reference for quick reconnect.
   */
  public async disconnect(): Promise<void> {
    await this.cleanDisconnect(false);
    this.logger("info", "Disconnected (device cached for dialog-free reconnect).");
  }

  /**
   * Queries dial screen dimensions, compression support, and max chunk length (`0x20/0x02`).
   *
   * @param timeoutMs - Response timeout in milliseconds (defaults to {@link DIAL_INFO_TIMEOUT_MS}).
   * @returns Parsed {@link ClockDialInfo} descriptor.
   * @throws {Error} When disconnected, response times out, or payload is malformed.
   */
  public async getDialInfo(timeoutMs = DIAL_INFO_TIMEOUT_MS): Promise<ClockDialInfo> {
    const wait = this.waitForFrame(
      (cmdId, cmdKey) =>
        cmdId === BLE_MODULE.DIAL_CONTROL && cmdKey === BLE_SUB_CMD.GET_DIAL_INFO,
      timeoutMs,
      "GET_DIAL_INFO (0x20/0x02)"
    );

    await this.writeQueue.enqueue(buildGetDialInfoFrame(), {
      delayAfterMs: COMMAND_WRITE_DELAY_MS,
      label: "GET_DIAL_INFO (0x20/0x02)",
    });

    const { payload } = await wait;
    const parsed = parseClockDialInfo(payload);
    this.lastDialInfo = parsed;
    this.logger(
      "info",
      `Dial info: ${parsed.width}x${parsed.height} (${parsed.shape}), ${parsed.algorithmName}, pkg=${parsed.watchThemeShortPkgLength}B`
    );
    return parsed;
  }

  /**
   * Queries remaining flash storage space on the BG02 badge (`0x20/0x04`).
   *
   * @param timeoutMs - Response timeout in milliseconds (defaults to {@link FREE_STORAGE_TIMEOUT_MS}).
   * @returns Available storage in bytes, or `null` if firmware omitted the 64-bit count.
   */
  public async getFreeStorage(timeoutMs = FREE_STORAGE_TIMEOUT_MS): Promise<number | null> {
    const wait = this.waitForFrame(
      (cmdId, cmdKey) =>
        cmdId === BLE_MODULE.DIAL_CONTROL && cmdKey === BLE_SUB_CMD.GET_FREE_STORAGE,
      timeoutMs,
      "GET_FREE_STORAGE (0x20/0x04)"
    );

    await this.writeQueue.enqueue(buildGetFreeStorageFrame(), {
      delayAfterMs: COMMAND_WRITE_DELAY_MS,
      label: "GET_FREE_STORAGE (0x20/0x04)",
    });

    const { cmdKey, payload } = await wait;
    this.logger(
      "rx",
      `Free storage response (0x20/0x${cmdKey.toString(16)}): ${toHexPreview(payload)}`
    );
    return parseFreeStorageBytes(payload);
  }

  /**
   * Reads standard BLE Battery Service (`0x180F`) and Device Information Service (`0x180A`).
   *
   * @returns Populated {@link StandardDeviceInfo} containing readable optional fields.
   * @throws {Error} When the GATT server is not connected.
   */
  public async readStandardInfo(): Promise<StandardDeviceInfo> {
    if (!this.server?.connected) {
      throw new Error("BG02 is not connected");
    }

    let batteryPercent: number | undefined;
    try {
      const batteryService = await this.server.getPrimaryService(STANDARD_SERVICES.BATTERY);
      const levelChar = await batteryService.getCharacteristic(
        STANDARD_CHARACTERISTICS.BATTERY_LEVEL
      );
      const val = await levelChar.readValue();
      batteryPercent = val.getUint8(0);
    } catch {
      // Optional service or restricted on some firmware states
    }

    let manufacturer: string | undefined;
    let model: string | undefined;
    let firmwareRevision: string | undefined;
    let hardwareRevision: string | undefined;
    let softwareRevision: string | undefined;

    try {
      const dis = await this.server.getPrimaryService(STANDARD_SERVICES.DEVICE_INFO);
      const readDisString = async (uuid: string): Promise<string | undefined> => {
        try {
          const ch = await dis.getCharacteristic(uuid);
          const dv = await ch.readValue();
          return disDecoder.decode(dv).replace(/\0+$/, "");
        } catch {
          return undefined;
        }
      };

      manufacturer = await readDisString(STANDARD_CHARACTERISTICS.MANUFACTURER_NAME);
      model = await readDisString(STANDARD_CHARACTERISTICS.MODEL_NUMBER);
      firmwareRevision = await readDisString(STANDARD_CHARACTERISTICS.FIRMWARE_REVISION);
      hardwareRevision = await readDisString(STANDARD_CHARACTERISTICS.HARDWARE_REVISION);
      softwareRevision = await readDisString(STANDARD_CHARACTERISTICS.SOFTWARE_REVISION);
    } catch {
      // Optional service
    }

    return {
      batteryPercent,
      manufacturer,
      model,
      firmwareRevision,
      hardwareRevision,
      softwareRevision,
    };
  }

  /**
   * Uploads a Baseline JPEG byte payload to BG02 using the `WatchTheme3` (`Lgh3`) state machine.
   *
   * Protocol sequence:
   * 1. Wrap JPEG bytes with `[uint32_be(len), ...imageBytes]`.
   * 2. Send Start (`0x1F/0x02`) and await `0x20/0x01` code `1000`.
   * 3. Send numbered Chunks (`0x1F/0x01`) with `byteSum32` and await `1000 + seq` (retrying up to 3×).
   * 4. Send Finish (`0x1F/0x03`) with whole-buffer `byteSum32` and await code `2`.
   *
   * @param imageBytes - Validated Baseline (`SOF0`) JPEG byte buffer.
   * @param options - Optional watch ID, chunk size override, and progress listener.
   * @returns Verification summary resolved when firmware confirms flash write completion.
   * @throws {Bg02ProtocolError | Error} When disconnected, firmware reports an error code, or timeout expires.
   */
  public async uploadDialImage(
    imageBytes: Uint8Array,
    options: UploadDialOptions = {}
  ): Promise<UploadDialResult> {
    if (!this.isConnected) {
      throw new Error("BG02 is not connected");
    }

    const startTimeMs = Date.now();
    const watchId = options.watchId ?? DEFAULT_WATCH_ID;
    const fileType = options.fileType ?? DIAL_FILE_TYPE_JPEG;
    const effectiveChunk =
      options.chunkSize ??
      this.lastDialInfo?.watchThemeShortPkgLength ??
      DEFAULT_DIAL_CHUNK_BYTES;
    const onProgress = options.onProgress ?? (() => undefined);

    const wrapped = wrapDialPayload(imageBytes);
    const totalChecksum = byteSum32(wrapped);
    const totalChunks = Math.max(1, Math.ceil(wrapped.length / effectiveChunk));

    this.logger(
      "info",
      `Starting WatchTheme3 upload: img=${imageBytes.length}B, wrapped=${wrapped.length}B, chunk=${effectiveChunk}B, watchId=${watchId}`
    );

    const startFrame = buildDialStartFrame({
      watchId,
      fileType,
      wrappedLength: wrapped.length,
      cfgMask: DIAL_CFG_MASK_BG_ONLY,
    });

    return new Promise<UploadDialResult>((resolve, reject) => {
      let nextIdx = 0;
      let sentAckedIdx = -1;
      let offset = 0;
      let lastChunkPacket: Uint8Array | null = null;
      let retryCount = 0;
      let finishAttempt = 0;
      let finishSent = false;
      let settled = false;
      let stallTimer: ReturnType<typeof setTimeout> | null = null;

      const clearTimer = (): void => {
        if (stallTimer !== null) {
          clearTimeout(stallTimer);
          stallTimer = null;
        }
      };

      const cleanup = (): void => {
        clearTimer();
        this.dialResponseHandler = null;
      };

      const fail = (err: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(err);
      };

      const succeed = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        onProgress({
          ratio: 1,
          sentBytes: wrapped.length,
          totalBytes: wrapped.length,
          currentChunk: totalChunks,
          totalChunks,
        });
        resolve({
          imageBytes: imageBytes.length,
          payloadBytes: wrapped.length,
          totalChecksum,
          elapsedMs: Date.now() - startTimeMs,
        });
      };

      const armTimer = (
        expectedNextIdx: number,
        onTimeout: () => void,
        timeoutMs = DIAL_STEP_RESPONSE_TIMEOUT_MS
      ): void => {
        clearTimer();
        if (settled) {
          return;
        }
        stallTimer = setTimeout(() => {
          stallTimer = null;
          if (settled || nextIdx !== expectedNextIdx) {
            return;
          }
          onTimeout();
        }, timeoutMs);
      };

      const handleFinishTimeout = async (expectedNext: number): Promise<void> => {
        if (settled || nextIdx !== expectedNext || !finishSent) {
          return;
        }
        if (finishAttempt >= DIAL_MAX_FINISH_RETRIES) {
          fail(new Bg02ProtocolError("Finish ACK (0x20/0x01=2) timed out"));
          return;
        }
        finishAttempt += 1;
        this.logger(
          "warn",
          `Finish ACK (0x20/0x01=2) timed out -> polling status & retrying DIAL_FINISH (${finishAttempt}/${DIAL_MAX_FINISH_RETRIES})`
        );
        try {
          await sendFinishFrame(true, expectedNext);
        } catch (err) {
          fail(err);
        }
      };

      const sendFinishFrame = async (isRetry: boolean, expectedNext: number): Promise<void> => {
        if (settled) {
          return;
        }
        if (!this.isConnected) {
          fail(new Error("BLE connection closed"));
          return;
        }
        if (isRetry) {
          // 意図: 公式 APK (`Lgh3.L` -> `Lqm2.h`) と同様に 0x20/0x01 状態照会を先行させ、完了通知の取りこぼしを回収する。
          await this.writeQueue.enqueue(buildReadDialStatusFrame(), {
            delayAfterMs: COMMAND_WRITE_DELAY_MS,
            label: `READ_DIAL_STATUS (0x20/0x01, retry ${finishAttempt}/${DIAL_MAX_FINISH_RETRIES})`,
          });
          if (settled || nextIdx !== expectedNext) {
            return;
          }
          if (!this.isConnected) {
            fail(new Error("BLE connection closed"));
            return;
          }
        }
        const finishFrame = buildDialFinishFrame(totalChecksum);
        await this.writeQueue.enqueue(finishFrame, {
          delayAfterMs: DIAL_CHUNK_WRITE_DELAY_MS,
          label: isRetry
            ? `DIAL_FINISH RETRY (${finishAttempt}/${DIAL_MAX_FINISH_RETRIES}, sum=0x${totalChecksum.toString(16)})`
            : `DIAL_FINISH (sum=0x${totalChecksum.toString(16)})`,
        });
        // 意図: GATT 20B 分割送信の完了を待ってから応答・再送タイマーを起動する。
        if (!settled && finishSent && nextIdx === expectedNext) {
          armTimer(
            expectedNext,
            () => {
              void handleFinishTimeout(expectedNext);
            },
            DIAL_FINISH_STEP_TIMEOUT_MS
          );
        }
      };

      const sendNextOrFinish = async (): Promise<void> => {
        try {
          clearTimer();
          if (offset >= wrapped.length) {
            if (!finishSent) {
              finishSent = true;
              finishAttempt = 0;
              await sendFinishFrame(false, nextIdx);
            }
            return;
          }

          const end = Math.min(offset + effectiveChunk, wrapped.length);
          const slice = wrapped.subarray(offset, end);
          const idx1 = nextIdx + 1;
          const chunkFrame = buildDialChunkFrame(idx1, slice);

          lastChunkPacket = chunkFrame;
          retryCount = 0;
          sentAckedIdx = nextIdx;
          nextIdx += 1;
          offset = end;
          const expectedNext = nextIdx;

          const handleChunkTimeout = async (): Promise<void> => {
            if (
              settled ||
              nextIdx !== expectedNext ||
              !lastChunkPacket ||
              retryCount >= DIAL_MAX_CHUNK_RETRIES
            ) {
              fail(new Bg02ProtocolError(`Chunk #${idx1} ACK timed out`));
              return;
            }
            retryCount += 1;
            this.logger(
              "warn",
              `Chunk #${idx1} timed out -> retrying (${retryCount}/${DIAL_MAX_CHUNK_RETRIES})`
            );
            try {
              await this.writeQueue.enqueue(lastChunkPacket, {
                delayAfterMs: DIAL_CHUNK_WRITE_DELAY_MS,
                label: `RETRY #${idx1}`,
              });
              if (!settled && nextIdx === expectedNext) {
                armTimer(expectedNext, () => {
                  void handleChunkTimeout();
                });
              }
            } catch (err) {
              fail(err);
            }
          };

          this.logger(
            "tx",
            `-> TX CHUNK #${idx1}/${totalChunks} (${slice.length}B data, frame ${chunkFrame.length}B, ${offset}/${wrapped.length}B)`
          );

          await this.writeQueue.enqueue(chunkFrame, {
            delayAfterMs: DIAL_CHUNK_WRITE_DELAY_MS,
          });

          onProgress({
            ratio: Math.min(0.95, offset / wrapped.length),
            sentBytes: offset,
            totalBytes: wrapped.length,
            currentChunk: idx1,
            totalChunks,
          });

          if (!settled && nextIdx === expectedNext) {
            armTimer(expectedNext, () => {
              void handleChunkTimeout();
            });
          }
        } catch (err) {
          fail(err);
        }
      };

      this.dialResponseHandler = (code: number): void => {
        if (settled) {
          return;
        }
        this.logger("rx", `<- DIAL RESPONSE CODE: ${code}`);
        if (code >= DIAL_STATUS.SEQ_ACK_BASE && code < 100_000_000) {
          const seq = code - DIAL_STATUS.SEQ_ACK_BASE;
          if ((seq === 0 && nextIdx === 0) || (seq === nextIdx && seq > sentAckedIdx)) {
            clearTimer();
            void sendNextOrFinish();
          }
          return;
        }

        clearTimer();
        if (code === DIAL_STATUS.FINISH_OK) {
          succeed();
          return;
        }

        const errorKey = DIAL_ERROR_KEY_MAP[code];
        fail(
          new Bg02ProtocolError(
            `WatchTheme3 upload failed with device code ${code}`,
            code,
            errorKey
          )
        );
      };

      void (async () => {
        try {
          onProgress({
            ratio: 0,
            sentBytes: 0,
            totalBytes: wrapped.length,
            currentChunk: 0,
            totalChunks,
          });
          await this.writeQueue.enqueue(startFrame, {
            delayAfterMs: DIAL_CHUNK_WRITE_DELAY_MS,
            label: "DIAL_START (0x1F/0x02)",
          });
          if (!settled && nextIdx === 0) {
            armTimer(0, () => {
              fail(new Bg02ProtocolError("Upload start ACK (responseCode=1000) timed out"));
            });
          }
        } catch (err) {
          fail(err);
        }
      })();
    });
  }

  /**
   * Verifies `navigator.bluetooth` existence before attempting discovery.
   *
   * @returns Available {@link WebBluetoothApi} object.
   * @throws {Error} When running in an unsupported browser or non-secure HTTP context.
   */
  private requireWebBluetooth(): WebBluetoothApi {
    if (typeof navigator === "undefined" || !navigator.bluetooth) {
      throw new Error(
        "Web Bluetooth API is not supported in this browser (requires Chrome / Edge over HTTPS or localhost)."
      );
    }
    return navigator.bluetooth;
  }

  /**
   * Discovers the `7e400001` primary service, resolves TX/RX characteristics, and starts notifications.
   *
   * @param server - Connected GATT server instance.
   */
  private async discoverAndSubscribe(server: WebBluetoothGattServer): Promise<void> {
    const service: WebBluetoothService = await server.getPrimaryService(MYWATCH_SERVICE_UUID);
    const writeChar = await service.getCharacteristic(MYWATCH_WRITE_UUID);
    const notify1 = await service.getCharacteristic(MYWATCH_NOTIFY1_UUID);
    const subscribed: WebBluetoothCharacteristic[] = [notify1];

    try {
      const notify2 = await service.getCharacteristic(MYWATCH_NOTIFY2_UUID);
      subscribed.push(notify2);
    } catch {
      // Some firmware builds expose only 7e400003
    }

    for (const ch of subscribed) {
      if (!this.boundNotifyChars.has(ch)) {
        this.boundNotifyChars.add(ch);
        ch.addEventListener("characteristicvaluechanged", (ev: Event) => {
          const typed = ev as WebBluetoothValueChangedEvent;
          const dv = typed.target?.value;
          if (!dv) {
            return;
          }
          const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
          this.handleNotify(bytes);
        });
      }
      await ch.startNotifications();
      this.logger("info", `Subscribed notify characteristic: ${ch.uuid.slice(0, 8)}...`);
    }

    this.writeChar = writeChar;
    this.notifyChars = subscribed;
    this.logger(
      "info",
      `GATT ready (write=${writeChar.properties.write}, writeNoResp=${writeChar.properties.writeWithoutResponse}, notifies=${subscribed.length})`
    );
  }

  /**
   * Handles incoming GATT notification chunks, sends mandatory `0xDC` ACKs, and dispatches frames.
   *
   * @param incomingPacket - Raw bytes extracted from a `characteristicvaluechanged` event.
   */
  private handleNotify(incomingPacket: Uint8Array): void {
    const result = consumeNotifyChunk(this.rxBuffer, incomingPacket);
    this.rxBuffer = new Uint8Array(result.nextBuffer);

    for (const ack of result.ackPackets) {
      this.logger("rx", `<- RX ACK (0xDC, ${ack.length}B): ${toHexPreview(ack)}`);
    }

    for (const frame of result.frames) {
      this.logger(
        "rx",
        `<- RX cmd=0x${frame.cmdId.toString(16)} sub=0x${frame.cmdKey.toString(16)} (${frame.payload.length}B payload)`
      );

      // 意図: 受信した全ての 0xCD フレームに対して 0xDC ACK を即座に返送しない場合、BG02 がコマンド応答の再送やリンク切断を起こす。
      const ackFrame = encodeAck(frame.cmdId, frame.cmdKey, frame.frameLength);
      this.writeQueue
        .enqueue(ackFrame, {
          priority: true,
          delayAfterMs: COMMAND_WRITE_DELAY_MS,
          label: `ACK(0x${frame.cmdId.toString(16)}/0x${frame.cmdKey.toString(16)})`,
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger("warn", `Failed to send 0xDC ACK: ${msg}`);
        });

      this.dispatchFrame(frame);
    }
  }

  /**
   * Routes a decoded `0xCD` response frame to dial progress handlers and pending command waiters.
   *
   * @param frame - Complete parsed RX frame.
   */
  private dispatchFrame(frame: ParsedRxFrame): void {
    if (
      frame.cmdId === BLE_MODULE.DIAL_CONTROL &&
      frame.cmdKey === BLE_SUB_CMD.DIAL_RESPONSE &&
      frame.payload.length >= 4
    ) {
      const dv = new DataView(
        frame.payload.buffer,
        frame.payload.byteOffset,
        frame.payload.byteLength
      );
      const code = dv.getUint32(0, false);
      this.dialResponseHandler?.(code);
    }

    for (let i = 0; i < this.waiters.length; i++) {
      const waiter = this.waiters[i];
      if (waiter.match(frame.cmdId, frame.cmdKey, frame.payload)) {
        this.waiters.splice(i, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(frame);
        return;
      }
    }
  }

  /**
   * Registers a timed one-shot waiter for a matching incoming `0xCD` frame.
   *
   * @param match - Predicate matching the expected module, sub-command, and payload.
   * @param timeoutMs - Timeout threshold in milliseconds.
   * @param label - Diagnostic command label included in timeout errors.
   * @returns Promise resolving with the matched {@link ParsedRxFrame}.
   */
  private waitForFrame(
    match: (cmdId: number, cmdKey: number, payload: Uint8Array) => boolean,
    timeoutMs: number,
    label: string
  ): Promise<ParsedRxFrame> {
    return new Promise<ParsedRxFrame>((resolve, reject) => {
      const waiter: PendingFrameWaiter = {
        match,
        resolve,
        reject,
        timer: setTimeout(() => {
          const idx = this.waiters.indexOf(waiter);
          if (idx >= 0) {
            this.waiters.splice(idx, 1);
          }
          reject(new Bg02ProtocolError(`${label} timed out (${timeoutMs}ms)`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  /**
   * Clears runtime queues, RX buffer, and rejects any waiting callers when the link drops.
   */
  private resetSessionState(): void {
    this.writeChar = null;
    this.notifyChars = [];
    this.rxBuffer = new Uint8Array(0);
    this.dialResponseHandler = null;
    const err = new Error("BLE connection closed");
    this.writeQueue.reset(err);

    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.reject(err);
      }
    }
  }

  /**
   * Registers a single `gattserverdisconnected` observer per {@link WebBluetoothDevice} instance.
   *
   * @param dev - Bluetooth device handle to monitor.
   */
  private attachDisconnectHandler(dev: WebBluetoothDevice): void {
    // 意図: 再接続や getDevices() 再読込のたびに同一デバイスへリスナーを追加しないよう WeakSet で 1 回のみ購読する。
    if (this.boundDisconnectDevices.has(dev)) {
      return;
    }
    this.boundDisconnectDevices.add(dev);
    dev.addEventListener("gattserverdisconnected", () => {
      const isSuppressed = this.suppressedDisconnectIds.delete(dev.id);
      const isManual = this.expectedDisconnectIds.delete(dev.id);
      if (isSuppressed) {
        return;
      }
      // 意図: 別のバッジへ切り替え中に旧デバイスから遅れて切断通知が届いた場合、新セッションを壊さないよう無視する。
      if (dev.id !== this.activeDeviceId) {
        return;
      }
      this.server = null;
      this.resetSessionState();
      const reason: DisconnectReason = isManual ? "manual" : "unexpected";
      this.logger(
        isManual ? "info" : "warn",
        isManual
          ? `GATT server disconnected (${dev.name || dev.id}).`
          : `GATT server disconnected unexpectedly (${dev.name || dev.id}).`
      );
      this.onDisconnectCallback?.(reason, dev.id);
    });
  }

  /**
   * Gracefully stops notifications, closes the GATT link, and optionally clears the active device handle.
   *
   * @param clearDevice - When `true`, forgets the active handle and `lastDialInfo` so next connect prompts.
   * @param suppressCallback - When `true`, suppresses firing `onDisconnectCallback` during internal `connect()` switches.
   */
  private async cleanDisconnect(clearDevice: boolean, suppressCallback = false): Promise<void> {
    const activeDev = this.device;
    for (const ch of this.notifyChars) {
      try {
        if (this.server?.connected) {
          await ch.stopNotifications();
        }
      } catch {
        // Ignore if link already disconnected
      }
    }

    if (activeDev?.gatt?.connected) {
      // 意図: 明示切断は manual、connect() 切り替え時の内部切断はコールバック抑止として識別できるようにする。
      if (suppressCallback) {
        this.suppressedDisconnectIds.add(activeDev.id);
      } else {
        this.expectedDisconnectIds.add(activeDev.id);
      }
      try {
        activeDev.gatt.disconnect();
      } catch {
        this.expectedDisconnectIds.delete(activeDev.id);
        this.suppressedDisconnectIds.delete(activeDev.id);
      }
    }

    this.resetSessionState();
    this.server = null;

    if (clearDevice) {
      if (this.activeDeviceId) {
        this.deviceCache.delete(this.activeDeviceId);
      }
      this.activeDeviceId = null;
      this.lastDialInfo = null;
    }
  }
}
