/**
 * @module imaging/jpegInspector
 * Pure structural parser inspecting JPEG marker segments (`SOI`, `SOF0`, `SOF2`)
 * before transmission so unsupported Progressive JPEGs never reach the BG02 badge.
 */

import type { JpegInspectionResult } from "./types";

/**
 * Inspects an encoded JPEG buffer to verify JFIF `SOI` and Baseline DCT (`SOF0` / `0xFFC0`).
 *
 * // 意図: BG02 実機は Baseline JPEG (SOF0) のみを受理し Progressive JPEG (SOF2) はハングや拒否の原因となるため送信前ゲートとして検証する。
 *
 * @param bytes - Raw JPEG file or canvas-encoded bytes.
 * @returns Validation status, Baseline flag, dimensions, and diagnostic error code if rejected.
 */
export function inspectJpeg(bytes: Uint8Array): JpegInspectionResult {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return {
      valid: false,
      baseline: false,
      width: null,
      height: null,
      errorCode: "missing_soi",
    };
  }

  let index = 2;
  while (index + 3 < bytes.length) {
    if (bytes[index] !== 0xff) {
      index += 1;
      continue;
    }

    // 意図: JPEG 規格上、マーカー直前には複数の 0xFF フィルバイトが入ることが許容されているため読み飛ばす。
    while (index < bytes.length && bytes[index] === 0xff) {
      index += 1;
    }
    if (index >= bytes.length) {
      break;
    }

    const marker = bytes[index];
    index += 1;

    if (marker === 0xd9 || marker === 0xda) {
      // EOI (0xFFD9) または SOS (0xFFDA) に到達したらフレームヘッダ探索を終了する。
      break;
    }

    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd8)) {
      // バイトスタッフィング (0x00) や RSTm/SOI などの長さフィールドを持たないスタンドアロンマーカー。
      continue;
    }

    if (index + 1 >= bytes.length) {
      break;
    }

    const segmentLength = (bytes[index] << 8) | bytes[index + 1];

    if (marker === 0xc0 && index + 6 < bytes.length) {
      const height = (bytes[index + 3] << 8) | bytes[index + 4];
      const width = (bytes[index + 5] << 8) | bytes[index + 6];
      return {
        valid: true,
        baseline: true,
        width,
        height,
        markerType: "SOF0",
      };
    }

    if (marker === 0xc2) {
      const hasDims = index + 6 < bytes.length;
      const height = hasDims ? (bytes[index + 3] << 8) | bytes[index + 4] : null;
      const width = hasDims ? (bytes[index + 5] << 8) | bytes[index + 6] : null;
      return {
        valid: true,
        baseline: false,
        width,
        height,
        markerType: "SOF2",
        errorCode: "progressive_sof2",
      };
    }

    // 意図: 不正なゼロ長セグメントによる無限ループを防ぐため、必ず少なくとも 2 バイト以上進行する。
    index += Math.max(2, segmentLength);
  }

  return {
    valid: false,
    baseline: false,
    width: null,
    height: null,
    errorCode: "missing_sof0",
  };
}

/**
 * Checks whether an inspected JPEG matches BG02 upload requirements (`valid`, `baseline`, dimensions).
 *
 * @param inspection - Result returned by {@link inspectJpeg}.
 * @param expectedWidth - Optional required pixel width reported by device dial info.
 * @param expectedHeight - Optional required pixel height reported by device dial info.
 * @returns `true` if the JPEG is Baseline `SOF0` and matches expected dimensions when specified.
 */
export function isUploadableJpeg(
  inspection: JpegInspectionResult,
  expectedWidth?: number,
  expectedHeight?: number
): boolean {
  if (!inspection.valid || !inspection.baseline) {
    return false;
  }
  if (expectedWidth !== undefined && inspection.width !== expectedWidth) {
    return false;
  }
  if (expectedHeight !== undefined && inspection.height !== expectedHeight) {
    return false;
  }
  return true;
}
