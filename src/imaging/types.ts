/**
 * @module imaging/types
 * Type definitions for circular badge composition, interactive transform controls,
 * optional text overlay styling, JPEG optimization settings, and `SOF0` inspection results.
 */

import type { DisplayShape } from "../ble/types";

/** Affine alignment parameters mapping a user image onto the target BG02 frame. */
export interface ImageTransform {
  /** Horizontal pan offset in canvas pixels relative to frame center. */
  readonly offsetX: number;
  /** Vertical pan offset in canvas pixels relative to frame center. */
  readonly offsetY: number;
  /**
   * Relative zoom multiplier where `1.0` fills the square canvas at Cover scale.
   *
   * // 意図: 高解像度写真と低解像度アイコンで操作感を統一するため、絶対倍率ではなく Cover 基準の相対倍率として扱う。
   */
  readonly scale: number;
  /** Clockwise rotation angle in degrees normalized to `[-180, 180]`. */
  readonly rotationDeg: number;
  /** CSS hex background fill behind transparent PNGs or empty margins (e.g. `#0f172a`). */
  readonly backgroundColor: string;
}

/** Optional multi-line text overlay composited on top of the aligned badge image. */
export interface TextOverlayConfig {
  /** Whether to draw the text overlay (`false` by default so image alignment stays primary). */
  readonly enabled: boolean;
  /** Multi-line label text separated by `\n`. */
  readonly text: string;
  /** CSS font stack used for canvas rendering. */
  readonly fontFamily: string;
  /** Font size in canvas pixels. */
  readonly fontSizePx: number;
  /** Solid fill color in `#rrggbb` notation. */
  readonly textColor: string;
  /** Outline stroke color improving legibility over complex photography. */
  readonly strokeColor: string;
  /** Outline stroke width in canvas pixels (`0` disables stroke). */
  readonly strokeWidthPx: number;
  /** Vertical placement offset in canvas pixels relative to vertical center. */
  readonly offsetY: number;
}

/** Strategy and target budget for Baseline JPEG export encoding. */
export interface JpegEncodingConfig {
  /**
   * Automatically searches JPEG quality downward to stay within `targetMaxBytes`.
   *
   * // 意図: BLE 転送速度と画質のバランスに優れる 15 KiB 目安を、画質スライダーの手動試行なしで自動達成する。
   */
  readonly autoOptimize: boolean;
  /** Soft byte budget in bytes (default `15360`). */
  readonly targetMaxBytes: number;
  /** Explicit JPEG quality in `[0.1, 1.0]` used when `autoOptimize` is `false`. */
  readonly manualQuality: number;
}

/** Diagnostic reason key emitted when {@link JpegInspectionResult} fails validation. */
export type JpegValidationErrorCode =
  | "missing_soi"
  | "progressive_sof2"
  | "missing_sof0";

/** Structural validation result returned by Baseline JPEG marker inspection. */
export interface JpegInspectionResult {
  /** `true` when SOI header exists and a frame header was decoded cleanly. */
  readonly valid: boolean;
  /** `true` strictly when the image uses Baseline DCT (`SOF0` / `0xFFC0`). */
  readonly baseline: boolean;
  /** Decoded image width in pixels, or `null` if invalid/undecoded. */
  readonly width: number | null;
  /** Decoded image height in pixels, or `null` if invalid/undecoded. */
  readonly height: number | null;
  /** Frame marker variant encountered (`"SOF0"` supported, `"SOF2"` rejected by BG02). */
  readonly markerType?: "SOF0" | "SOF2";
  /** Machine-readable failure reason mapped to localized UI alerts. */
  readonly errorCode?: JpegValidationErrorCode;
}

/** Rendered export output produced by the badge compositor pipeline. */
export interface CompositedBadgeResult {
  /** Encoded Baseline JPEG binary ready for WatchTheme3 transfer. */
  readonly jpegBytes: Uint8Array;
  /** Exact encoded byte count (`jpegBytes.length`). */
  readonly byteLength: number;
  /** Final JPEG encoder quality factor (`0.1` .. `1.0`) that produced `jpegBytes`. */
  readonly usedQuality: number;
  /** `true` when `byteLength` still exceeds `targetMaxBytes` even at minimum quality. */
  readonly exceedsTarget: boolean;
  /** Structural SOF0/dimensions inspection result computed from `jpegBytes`. */
  readonly inspection: JpegInspectionResult;
  /** Offscreen rasterized canvas holding the exact 240×240 export bitmap without guide overlays. */
  readonly exportCanvas: HTMLCanvasElement;
}

/** Dimension specification passed to compositor renderers and preview helpers. */
export interface BadgeTargetGeometry {
  /** Target width in pixels (default `240`). */
  readonly width: number;
  /** Target height in pixels (default `240`). */
  readonly height: number;
  /** Display silhouette determining whether circular safe-area guides render in preview. */
  readonly shape: DisplayShape;
}
