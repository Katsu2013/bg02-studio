/**
 * @module ble/writeQueue
 * Serialized GATT write queue that segments outbound protocol frames into <=20-byte chunks,
 * enforces pacing delays, and prioritizes incoming `0xDC` ACK frames ahead of bulk chunks.
 */

import {
  COMMAND_WRITE_DELAY_MS,
  GATT_CHUNK_SIZE,
  WRITE_WITHOUT_RESPONSE_PACING_MS,
} from "../constants/ble";
import { toHexPreview } from "./frameCodec";
import type { LogLevel, WriteQueueOptions } from "./types";
import type { WebBluetoothCharacteristic } from "./webBluetooth.types";

/** Internal queued write operation waiting for exclusive GATT characteristic access. */
export interface QueuedWriteItem {
  /** Immutable byte buffer copied at enqueue time. */
  readonly bytes: Uint8Array;
  /** Session generation counter captured when this write was queued. */
  readonly generation: number;
  /** Delay in milliseconds after all 20-byte slices finish writing. */
  readonly delayAfterMs: number;
  /** Optional log label shown when `enqueue` starts transmitting. */
  readonly label?: string;
  /** Promise fulfillment handler invoked after the write and trailing pause complete. */
  readonly resolve: () => void;
  /** Promise rejection handler invoked if the characteristic disconnects or fails. */
  readonly reject: (reason: unknown) => void;
}

/** Logger callback invoked by {@link BleWriteQueue} to record TX frames and diagnostics. */
export type QueueLogger = (level: LogLevel, message: string) => void;

/**
 * Pauses execution asynchronously for the requested duration in milliseconds.
 *
 * @param ms - Wait duration in milliseconds.
 * @returns Promise resolving once the timer elapses.
 */
export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serializes all outbound BLE GATT writes across a single write characteristic.
 *
 * // 意図: Web Bluetooth は同一キャラクタリスティックへの同時 writeValue* 呼び出しを拒否するため、完全直列化キューで排他制御を行う。
 */
export class BleWriteQueue {
  /** Pending write operations awaiting sequential execution. */
  private readonly queue: QueuedWriteItem[] = [];
  /** Monotonic connection generation incremented on every `reset()`. */
  private generation = 0;
  /** Monotonic loop token identifying each started `drain()` execution. */
  private nextDrainToken = 0;
  /** Token of the currently active `drain()` loop, or `null` when idle or reset. */
  private activeDrainToken: number | null = null;
  /** Rejection hook for the item currently mid-write so `reset()` never leaves callers hanging. */
  private activeInFlightReject: ((err: Error) => void) | null = null;
  /** Callback querying current GATT write characteristic when connected, or `null`. */
  private readonly getWriteCharacteristic: () => WebBluetoothCharacteristic | null;
  /** Callback indicating whether to prefer `writeValueWithoutResponse`. */
  private readonly getPreferWriteWithoutResponse: () => boolean;
  /** Diagnostic logger callback. */
  private readonly logger: QueueLogger;

  /**
   * Creates a serialized GATT write queue bound to characteristic/mode accessors.
   *
   * @param getWriteCharacteristic - Accessor returning active TX characteristic or `null` when disconnected.
   * @param getPreferWriteWithoutResponse - Accessor returning whether `writeWithoutResponse` is preferred.
   * @param logger - Logger callback receiving compact TX frame summaries.
   */
  public constructor(
    getWriteCharacteristic: () => WebBluetoothCharacteristic | null,
    getPreferWriteWithoutResponse: () => boolean,
    logger: QueueLogger
  ) {
    this.getWriteCharacteristic = getWriteCharacteristic;
    this.getPreferWriteWithoutResponse = getPreferWriteWithoutResponse;
    this.logger = logger;
  }

  /**
   * Queues a complete frame or ACK for segmented transmission.
   *
   * @param bytes - Outbound protocol frame or 8-byte `0xDC` ACK.
   * @param options - Priority routing, post-write delay, and logging options.
   * @returns Promise resolving after all <=20B segments finish writing and settle delay expires.
   * @throws {Error} When no active GATT write characteristic is currently available.
   */
  public enqueue(bytes: Uint8Array, options: WriteQueueOptions = {}): Promise<void> {
    if (!this.getWriteCharacteristic()) {
      return Promise.reject(new Error("BG02 is not connected"));
    }

    const { priority = false, delayAfterMs = COMMAND_WRITE_DELAY_MS, label } = options;
    const itemGeneration = this.generation;

    return new Promise<void>((resolve, reject) => {
      const item: QueuedWriteItem = {
        bytes: new Uint8Array(bytes),
        generation: itemGeneration,
        delayAfterMs,
        label,
        resolve,
        reject,
      };

      // 意図: 画像チャンク送信中に受信した 0xCD フレームへの 0xDC ACK を最優先で返却しないと、端末側が再送やタイムアウトを起こすため短パケット優先で先頭へ差し込む。
      if (priority && item.bytes.length <= GATT_CHUNK_SIZE) {
        this.queue.unshift(item);
      } else {
        this.queue.push(item);
      }

      void this.drain();
    });
  }

  /**
   * Advances queue generation and rejects any in-flight or queued writes immediately on teardown.
   *
   * @param error - Error instance passed to waiting caller promises.
   */
  public reset(error: Error): void {
    this.generation += 1;
    this.activeDrainToken = null;
    const abortCurrent = this.activeInFlightReject;
    this.activeInFlightReject = null;
    abortCurrent?.(error);

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      item?.reject(error);
    }
  }

  /**
   * Drains queued write items sequentially for the active queue generation only.
   */
  private async drain(): Promise<void> {
    if (this.activeDrainToken !== null) {
      return;
    }
    const myToken = ++this.nextDrainToken;
    const myGeneration = this.generation;
    this.activeDrainToken = myToken;

    const isStillCurrent = (): boolean =>
      this.activeDrainToken === myToken && this.generation === myGeneration;

    try {
      while (this.queue.length > 0 && isStillCurrent()) {
        const item = this.queue.shift();
        if (!item) {
          continue;
        }
        if (item.generation !== this.generation) {
          item.reject(new Error("BLE connection closed"));
          continue;
        }

        let settled = false;
        const rejectItem = (reason: unknown): void => {
          if (settled) {
            return;
          }
          settled = true;
          if (this.activeInFlightReject === rejectActive) {
            this.activeInFlightReject = null;
          }
          item.reject(reason);
        };
        const rejectActive = (err: Error): void => {
          rejectItem(err);
        };
        this.activeInFlightReject = rejectActive;

        try {
          const initialChar = this.getWriteCharacteristic();
          if (!initialChar) {
            throw new Error("GATT disconnected during write");
          }

          if (item.label) {
            this.logger("tx", `-> TX ${item.label} (${item.bytes.length}B): ${toHexPreview(item.bytes, 24)}`);
          }

          for (let offset = 0; offset < item.bytes.length; offset += GATT_CHUNK_SIZE) {
            if (!isStillCurrent() || this.getWriteCharacteristic() !== initialChar) {
              throw new Error("BLE connection closed");
            }
            const end = Math.min(offset + GATT_CHUNK_SIZE, item.bytes.length);
            const slice = item.bytes.subarray(offset, end);
            await this.writeSingleSegment(initialChar, slice);
            if (!isStillCurrent()) {
              throw new Error("BLE connection closed");
            }
          }

          if (item.delayAfterMs > 0) {
            await sleepMs(item.delayAfterMs);
            if (!isStillCurrent()) {
              throw new Error("BLE connection closed");
            }
          }

          if (!settled) {
            settled = true;
            if (this.activeInFlightReject === rejectActive) {
              this.activeInFlightReject = null;
            }
            item.resolve();
          }
        } catch (err) {
          rejectItem(err);
        }
      }
    } finally {
      if (this.activeDrainToken === myToken) {
        this.activeDrainToken = null;
        if (this.queue.length > 0 && this.getWriteCharacteristic() !== null) {
          void this.drain();
        }
      }
    }
  }

  /**
   * Writes a single <=20-byte slice using the best supported GATT write method.
   *
   * @param writeChar - Connected GATT TX characteristic.
   * @param segment - Slice of at most {@link GATT_CHUNK_SIZE} bytes.
   */
  private async writeSingleSegment(
    writeChar: WebBluetoothCharacteristic,
    segment: Uint8Array
  ): Promise<void> {
    // 意図: TypeScript 6 DOM 型定義上、subarray は ArrayBufferLike を参照するため、厳密な BufferSource 用に ArrayBuffer 切り出しコピーを渡す。
    const copy = new Uint8Array(segment);
    const preferNoResp = this.getPreferWriteWithoutResponse();

    if (preferNoResp && writeChar.properties.writeWithoutResponse && writeChar.writeValueWithoutResponse) {
      await writeChar.writeValueWithoutResponse(copy);
      await sleepMs(WRITE_WITHOUT_RESPONSE_PACING_MS);
      return;
    }

    if (writeChar.properties.write && writeChar.writeValueWithResponse) {
      await writeChar.writeValueWithResponse(copy);
      return;
    }

    if (writeChar.properties.writeWithoutResponse && writeChar.writeValueWithoutResponse) {
      await writeChar.writeValueWithoutResponse(copy);
      await sleepMs(WRITE_WITHOUT_RESPONSE_PACING_MS);
      return;
    }

    await writeChar.writeValue(copy);
  }
}
