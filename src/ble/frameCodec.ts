/**
 * @module ble/frameCodec
 * Pure binary encoder/decoder utilities for the BG02 (`mywatchsdklib`) protocol:
 * `0xCD` command/response framing, `0xDC` transport ACKs, RX stream reassembly,
 * `0x20/0x02` `ClockDialInfoBody` parsing, `0x20/0x04` storage decoding, and
 * `WatchTheme3` (`0x1F`) payload/checksum construction.
 */

import {
  ACK_START_BYTE,
  ALGORITHM_NAMES,
  BLE_MODULE,
  BLE_SUB_CMD,
  DEFAULT_DIAL_CHUNK_BYTES,
  FRAME_START_BYTE,
  MAX_RX_FRAME_BYTES,
  PAIR_HANDSHAKE_VALUE,
} from "../constants/ble";
import type {
  ClockDialInfo,
  DialStartOptions,
  NotifyStreamResult,
  ParsedRxFrame,
} from "./types";

/** Shared stateless UTF-8 decoder for ASCII/UTF-8 model and customer strings inside payloads. */
const utf8Decoder = new TextDecoder();

/**
 * Computes the unsigned 32-bit modular byte sum (`sum(bytes) mod 2^32`).
 *
 * // 意図: WatchTheme3 (`Lgh3`) プロトコルでは CRC-32 ではなく各バイトの単純加算下位 32bit (big-endian) をチャンク及び全体チェックサムとして要求する。
 *
 * @param bytes - Input byte sequence to sum.
 * @returns Unsigned 32-bit integer checksum (`0 .. 0xFFFFFFFF`).
 */
export function byteSum32(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    sum = (sum + bytes[i]) >>> 0;
  }
  return sum >>> 0;
}

/**
 * Formats a byte buffer as space-delimited lowercase hex pairs for protocol logging.
 *
 * @param bytes - Buffer to inspect.
 * @param maxBytes - Maximum bytes to format before truncating with `... (+N B)`.
 * @returns Formatted hexadecimal preview string.
 */
export function toHexPreview(bytes: Uint8Array, maxBytes = 32): string {
  const limit = Math.min(bytes.length, maxBytes);
  const parts: string[] = [];
  for (let i = 0; i < limit; i++) {
    parts.push(bytes[i].toString(16).padStart(2, "0"));
  }
  if (bytes.length > maxBytes) {
    parts.push(`... (+${bytes.length - maxBytes} B)`);
  }
  return parts.join(" ");
}

/**
 * Encodes a parameterless 8-byte `0xCD` command frame (`Lqm2` empty command format).
 *
 * Layout: `[0xCD, 0x00, 0x05, cmdId, 0x01, subCmd, 0x00, 0x00]`.
 *
 * @param cmdId - Module identifier (`frame[3]`).
 * @param subCmd - Sub-command identifier (`frame[5]`).
 * @returns Newly allocated 8-byte command frame.
 */
export function encodeCmdNoPayload(cmdId: number, subCmd: number): Uint8Array {
  return new Uint8Array([
    FRAME_START_BYTE,
    0x00,
    0x05,
    cmdId & 0xff,
    0x01,
    subCmd & 0xff,
    0x00,
    0x00,
  ]);
}

/**
 * Encodes a 9-byte `0xCD` command frame carrying a single uint8 payload byte.
 *
 * Layout: `[0xCD, 0x00, 0x06, cmdId, 0x01, subCmd, 0x00, 0x01, value]`.
 *
 * @param cmdId - Module identifier (`frame[3]`).
 * @param subCmd - Sub-command identifier (`frame[5]`).
 * @param value - Single unsigned byte value (`frame[8]`).
 * @returns Newly allocated 9-byte command frame.
 */
export function encodeCmdByte(cmdId: number, subCmd: number, value: number): Uint8Array {
  return new Uint8Array([
    FRAME_START_BYTE,
    0x00,
    0x06,
    cmdId & 0xff,
    0x01,
    subCmd & 0xff,
    0x00,
    0x01,
    value & 0xff,
  ]);
}

/**
 * Encodes an arbitrary-length `0xCD` command frame (`8 + payload.length` bytes).
 *
 * // 意図: lengthField (`bytes[1..2]`) にはコマンドヘッダ後半 5B + payload 長を格納し、bytes[6..7] には payload 長そのものを格納するのが mywatchsdklib 仕様である。
 *
 * @param cmdId - Module identifier (`frame[3]`).
 * @param subCmd - Sub-command identifier (`frame[5]`).
 * @param payload - Payload bytes appended at offset `8`.
 * @returns Complete framed command ready for GATT 20B segmentation.
 */
export function encodeCmdPayload(cmdId: number, subCmd: number, payload: Uint8Array): Uint8Array {
  const lengthField = payload.length + 5;
  const out = new Uint8Array(8 + payload.length);
  const dv = new DataView(out.buffer);
  out[0] = FRAME_START_BYTE;
  dv.setUint16(1, lengthField, false);
  out[3] = cmdId & 0xff;
  out[4] = 0x01;
  out[5] = subCmd & 0xff;
  dv.setUint16(6, payload.length, false);
  out.set(payload, 8);
  return out;
}

/**
 * Encodes an 8-byte `0xDC` link-layer ACK frame acknowledging a received `0xCD` frame.
 *
 * // 意図: APK の `bluetooth/c.g0 -> Lqm2.w` と同一フォーマット。端末が送出したフレーム長をエコーバックしないと端末側送信窓が進まずタイムアウトする。
 *
 * @param cmdId - Echoed module ID (`frame[3]`) from the received `0xCD` frame.
 * @param cmdKey - Echoed sub-command ID (`frame[5]`) from the received `0xCD` frame.
 * @param frameLength - Total byte length of the acknowledged `0xCD` frame.
 * @returns 8-byte `0xDC` ACK packet suitable for priority TX queue insertion.
 */
export function encodeAck(cmdId: number, cmdKey: number, frameLength: number): Uint8Array {
  const out = new Uint8Array(8);
  const dv = new DataView(out.buffer);
  out[0] = ACK_START_BYTE;
  out[1] = 0x00;
  out[2] = 0x05;
  out[3] = cmdId & 0xff;
  out[4] = cmdKey & 0xff;
  dv.setUint16(5, frameLength, false);
  out[7] = 0x01;
  return out;
}

/**
 * Builds the mandatory post-connect pairing handshake frame (`Lqm2.r`: `0x12/0x0A = 0x02`).
 *
 * // 意図: 実機 (BG02) は GATT 接続直後にこのフレームを受信しないとセッションを有効化せず後続コマンドに応答しない。
 *
 * @returns 9-byte `cd 00 06 12 01 0a 00 01 02` pairing frame.
 */
export function buildPairFrame(): Uint8Array {
  return encodeCmdByte(BLE_MODULE.SYSTEM, BLE_SUB_CMD.PAIR, PAIR_HANDSHAKE_VALUE);
}

/**
 * Builds the `GET_DIAL_INFO` query frame (`0x20/0x02`).
 *
 * @returns 8-byte command frame querying display dimensions and WatchTheme parameters.
 */
export function buildGetDialInfoFrame(): Uint8Array {
  return encodeCmdNoPayload(BLE_MODULE.DIAL_CONTROL, BLE_SUB_CMD.GET_DIAL_INFO);
}

/**
 * Builds the `GET_FREE_STORAGE` query frame (`0x20/0x04`).
 *
 * @returns 8-byte command frame querying available flash storage in bytes.
 */
export function buildGetFreeStorageFrame(): Uint8Array {
  return encodeCmdNoPayload(BLE_MODULE.DIAL_CONTROL, BLE_SUB_CMD.GET_FREE_STORAGE);
}

/**
 * Builds the `WatchTheme3` upgrade status poll frame (`Lqm2.h`: `0x20/0x01`, empty payload).
 *
 * // 意図: 公式 APK (`WatchTheme3Tools` / `Lgh3.L`) がタイムアウト監視中に送信する「読み出し・状態確認」フレームと同一形式。
 *
 * @returns 8-byte command frame prompting BG02 to emit its current `0x20/0x01` response code.
 */
export function buildReadDialStatusFrame(): Uint8Array {
  return encodeCmdNoPayload(BLE_MODULE.DIAL_CONTROL, BLE_SUB_CMD.DIAL_RESPONSE);
}

/**
 * Wraps raw JPEG bytes with the 4-byte big-endian length prefix required by `WatchTheme3` (`Lgh3`).
 *
 * @param imageBytes - Validated Baseline JPEG image bytes.
 * @returns Wrapped payload `[uint32_be(imageBytes.length), ...imageBytes]`.
 */
export function wrapDialPayload(imageBytes: Uint8Array): Uint8Array {
  const wrapped = new Uint8Array(4 + imageBytes.length);
  new DataView(wrapped.buffer).setUint32(0, imageBytes.length, false);
  wrapped.set(imageBytes, 4);
  return wrapped;
}

/**
 * Builds the `WatchTheme3` upload Start frame (`0x1F/0x02`, 17-byte payload `Lgh3.Q`).
 *
 * @param options - Watch face slot ID, file type, wrapped total length, and background bitmask.
 * @returns Complete `0x1F/0x02` start frame ready for TX queuing.
 */
export function buildDialStartFrame(options: DialStartOptions): Uint8Array {
  const startPayload = new Uint8Array(17);
  const dv = new DataView(startPayload.buffer);
  dv.setUint32(0, options.watchId >>> 0, false);
  startPayload[4] = options.fileType & 0xff;
  startPayload[5] = options.cfgMask & 0xff;
  // bytes 6..8 remain 0x00 (reserved RGB field unused for image background upload)
  dv.setUint32(9, options.wrappedLength >>> 0, false);
  // bytes 13..16 remain 0x00 (style/color trailer unused for bgBinPath upload)
  return encodeCmdPayload(BLE_MODULE.DIAL_TRANSFER, BLE_SUB_CMD.DIAL_START, startPayload);
}

/**
 * Builds a single `WatchTheme3` data chunk frame (`0x1F/0x01`) with a trailing uint32 byte sum.
 *
 * Payload format: `[uint16_be(chunkIndex1Based), ...slice, uint32_be(byteSum32(inner))]`.
 *
 * @param chunkIndex1Based - 1-based sequence index (`1, 2, ...`) matching expected `1000 + seq` ACKs.
 * @param chunkSlice - Slice taken from the wrapped `WatchTheme3` payload buffer.
 * @returns Framed `0x1F/0x01` chunk packet.
 */
export function buildDialChunkFrame(chunkIndex1Based: number, chunkSlice: Uint8Array): Uint8Array {
  const inner = new Uint8Array(2 + chunkSlice.length);
  new DataView(inner.buffer).setUint16(0, chunkIndex1Based & 0xffff, false);
  inner.set(chunkSlice, 2);
  const chunkSum = byteSum32(inner);

  const pktPayload = new Uint8Array(inner.length + 4);
  pktPayload.set(inner, 0);
  new DataView(pktPayload.buffer).setUint32(inner.length, chunkSum, false);

  return encodeCmdPayload(BLE_MODULE.DIAL_TRANSFER, BLE_SUB_CMD.DIAL_CHUNK, pktPayload);
}

/**
 * Builds the `WatchTheme3` transfer Finish frame (`0x1F/0x03`) carrying the whole-payload byte sum.
 *
 * @param totalChecksum - Unsigned 32-bit `byteSum32()` across the entire `[len_be, ...image]` buffer.
 * @returns Complete `0x1F/0x03` finish frame expecting response code `2`.
 */
export function buildDialFinishFrame(totalChecksum: number): Uint8Array {
  const finPayload = new Uint8Array(4);
  new DataView(finPayload.buffer).setUint32(0, totalChecksum >>> 0, false);
  return encodeCmdPayload(BLE_MODULE.DIAL_TRANSFER, BLE_SUB_CMD.DIAL_FINISH, finPayload);
}

/**
 * Incrementally parses incoming BLE notification bytes into `0xDC` ACKs and full `0xCD` frames.
 *
 * // 意図: 1 つの BLE 通知パケットが 20B 単位で分割到着し、さらに 0xCD フレームを跨ぐ場合があるため、残余バイトを保持しつつ安全に同期再構築する。
 *
 * @param previousBuffer - Remainder buffer preserved from earlier notification events.
 * @param incomingPacket - Fresh bytes received from `characteristicvaluechanged`.
 * @returns Extracted `0xDC` packets, parsed `0xCD` frames, and remaining partial tail bytes.
 */
export function consumeNotifyChunk(
  previousBuffer: Uint8Array,
  incomingPacket: Uint8Array
): NotifyStreamResult {
  const ackPackets: Uint8Array[] = [];
  const frames: ParsedRxFrame[] = [];

  // 意図: 受信バッファが空かつ先頭が 0xDC のときのみトランスポート層 ACK とみなす（0xCD フレーム途中に偶発出現する 0xDC バイトを誤認しないため）。
  if (previousBuffer.length === 0 && incomingPacket.length >= 1 && incomingPacket[0] === ACK_START_BYTE) {
    ackPackets.push(new Uint8Array(incomingPacket));
    return { ackPackets, frames, nextBuffer: new Uint8Array(0) };
  }

  let rxBuf = new Uint8Array(previousBuffer.length + incomingPacket.length);
  rxBuf.set(previousBuffer, 0);
  rxBuf.set(incomingPacket, previousBuffer.length);

  while (rxBuf.length > 0) {
    if (rxBuf[0] !== FRAME_START_BYTE) {
      const nextStart = rxBuf.indexOf(FRAME_START_BYTE);
      if (nextStart < 0) {
        rxBuf = new Uint8Array(0);
        break;
      }
      rxBuf = rxBuf.subarray(nextStart);
    }

    if (rxBuf.length < 8) {
      break;
    }

    const bodyLen = (rxBuf[1] << 8) | rxBuf[2];
    const frameLength = bodyLen + 3;
    if (bodyLen < 5 || frameLength > MAX_RX_FRAME_BYTES) {
      // 意図: 不正長またはゴミバイト中の 0xCD に同期した場合は 1 バイト進めて次の同期点を探す。
      rxBuf = rxBuf.subarray(1);
      continue;
    }

    if (rxBuf.length < frameLength) {
      break;
    }

    const frame = rxBuf.slice(0, frameLength);
    rxBuf = rxBuf.slice(frameLength);

    frames.push({
      frameLength,
      cmdId: frame[3],
      cmdKey: frame[5],
      payload: frame.subarray(8),
    });
  }

  return {
    ackPackets,
    frames,
    nextBuffer: new Uint8Array(rxBuf),
  };
}

/**
 * Decodes the `ClockDialInfoBody` payload returned by BG02 `0x20/0x02` (`bluetooth/c.C`).
 *
 * @param payload - Raw frame payload starting at byte offset `8` of the `0x20/0x02` response.
 * @returns Structured dial geometry, hardware model names, algorithm, and WatchTheme limits.
 * @throws {Error} When the payload is shorter than the minimum header or declared string lengths overflow.
 */
export function parseClockDialInfo(payload: Uint8Array): ClockDialInfo {
  if (payload.length < 8) {
    throw new Error(`ClockDialInfo payload too short: ${payload.length}B`);
  }

  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const screenType = payload[0];
  const grade = dv.getInt8(1);
  const width = dv.getInt16(2, false);
  const height = dv.getInt16(4, false);

  const mchModelLen = payload[6];
  if (payload.length < 8 + mchModelLen) {
    throw new Error(`Invalid mchModelLen=${mchModelLen} for ${payload.length}B payload`);
  }
  const mchModel = utf8Decoder.decode(payload.subarray(7, 7 + mchModelLen)).replace(/\0+$/, "");

  const mainModelLen = payload[7 + mchModelLen];
  const mainStart = 8 + mchModelLen;
  if (payload.length < mainStart + mainModelLen) {
    throw new Error(`Invalid mainModelLen=${mainModelLen} for ${payload.length}B payload`);
  }
  const mainModel = utf8Decoder
    .decode(payload.subarray(mainStart, mainStart + mainModelLen))
    .replace(/\0+$/, "");

  const pos = mainStart + mainModelLen;

  let config: number | null = null;
  let algorithm: number | null = null;
  let versionCode: number | null = null;
  let customer = "";
  let pictureNums: number | null = null;
  let watchThemeVersion: number | null = null;
  let watchThemeShortPkgLength: number | null = null;
  let thumbWidth: number | null = null;
  let thumbHeight: number | null = null;

  if (payload.length > pos + 5) {
    config = payload[pos];
    algorithm = payload[pos + 1];
    const b0 = payload[pos + 2];
    const b1 = payload[pos + 3];
    const b2 = payload[pos + 4];
    if (b0 !== 0xff) {
      // 意図: APK の Checksum 式 `((b0 - b1) & 0xFF) == b2` に一致する場合は versionCode=0 として扱う仕様。
      versionCode = ((b0 - b1) & 0xff) === b2 ? 0 : b2;
    }

    const custLen = payload[pos + 5];
    const custStart = pos + 6;
    if (custLen > 0 && payload.length >= custStart + custLen) {
      const custParts: string[] = [];
      for (let i = custStart; i < custStart + custLen; i++) {
        const b = payload[i];
        custParts.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : b.toString(16).padStart(2, "0"));
      }
      customer = custParts.join("");
    }

    const pos2 = pos + 5 + custLen;
    if (payload.length > pos2 + 1) {
      pictureNums = payload[pos2 + 1];
    }
    if (payload.length >= pos2 + 4) {
      watchThemeVersion = dv.getUint16(pos2 + 2, false);
    }
    if (payload.length >= pos2 + 6) {
      watchThemeShortPkgLength = dv.getUint16(pos2 + 4, false);
    }
    if (payload.length >= pos2 + 10) {
      thumbWidth = dv.getUint16(pos2 + 6, false);
      thumbHeight = dv.getUint16(pos2 + 8, false);
    }
  }

  const algorithmName =
    algorithm === null
      ? "Unknown (null)"
      : ALGORITHM_NAMES[algorithm] ?? `Unknown (${algorithm})`;

  return {
    screenType,
    shape: screenType === 0 ? "square" : "round",
    grade,
    width,
    height,
    mchModel,
    mainModel,
    config,
    algorithm,
    algorithmName,
    versionCode,
    customer,
    pictureNums,
    watchThemeVersion,
    watchThemeShortPkgLength:
      watchThemeShortPkgLength !== null && watchThemeShortPkgLength > 0
        ? watchThemeShortPkgLength
        : DEFAULT_DIAL_CHUNK_BYTES,
    thumbWidth,
    thumbHeight,
  };
}

/**
 * Decodes the 64-bit big-endian free storage count returned by `0x20/0x04`.
 *
 * @param payload - Response payload bytes from `0x20/0x04`.
 * @returns Available bytes on flash storage, or `null` when payload is shorter than 8 bytes.
 */
export function parseFreeStorageBytes(payload: Uint8Array): number | null {
  if (payload.length < 8) {
    return null;
  }
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return Number(dv.getBigUint64(0, false));
}
