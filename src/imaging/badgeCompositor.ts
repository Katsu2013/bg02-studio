/**
 * @module imaging/badgeCompositor
 * Image alignment math, 240×240 offscreen canvas compositing with optional text overlay,
 * circular preview safe-area masking, and auto-optimizing Baseline JPEG export.
 */

import {
  DEFAULT_DISPLAY_SIZE_PX,
  RECOMMENDED_JPEG_MAX_BYTES,
} from "../constants/ble";
import type { DisplayShape } from "../ble/types";
import { inspectJpeg } from "./jpegInspector";
import type {
  BadgeTargetGeometry,
  CompositedBadgeResult,
  ImageTransform,
  JpegEncodingConfig,
  TextOverlayConfig,
} from "./types";

/** Lowest JPEG quality tested during 15 KiB auto-optimization search. */
export const AUTO_OPTIMIZE_MIN_QUALITY = 0.25;

/** Highest JPEG quality tested first during auto-optimization search. */
export const AUTO_OPTIMIZE_MAX_QUALITY = 0.92;

/** Number of binary-search iterations when converging on target byte budget. */
export const AUTO_OPTIMIZE_SEARCH_STEPS = 8;

/** Minimum allowed user relative zoom multiplier in the editor UI. */
export const MIN_RELATIVE_SCALE = 0.25;

/** Maximum allowed user relative zoom multiplier in the editor UI. */
export const MAX_RELATIVE_SCALE = 5.0;

/** Curated safe font stacks offered in the optional text overlay selector. */
export const AVAILABLE_FONT_FAMILIES: ReadonlyArray<{
  /** CSS font-family value applied to Canvas 2D context. */
  readonly value: string;
  /** Neutral human-readable label displayed in `<select>`. */
  readonly label: string;
}> = [
  { value: "system-ui, sans-serif", label: "System UI" },
  { value: "'Meiryo', 'Yu Gothic', sans-serif", label: "Meiryo / Sans-serif" },
  { value: "'Noto Serif JP', 'Yu Mincho', Georgia, serif", label: "Serif / Mincho" },
  { value: "ui-monospace, Consolas, monospace", label: "Monospace" },
];

/**
 * Returns default image placement transform centered at Cover scale (`1.0`).
 *
 * @returns Immutable initial {@link ImageTransform}.
 */
export function createDefaultTransform(): ImageTransform {
  return {
    offsetX: 0,
    offsetY: 0,
    scale: 1.0,
    rotationDeg: 0,
    backgroundColor: "#0f172a",
  };
}

/**
 * Returns default optional text overlay settings (`enabled: false` so images come first).
 *
 * @returns Immutable initial {@link TextOverlayConfig}.
 */
export function createDefaultTextOverlay(): TextOverlayConfig {
  return {
    enabled: false,
    text: "BG02",
    fontFamily: "system-ui, sans-serif",
    fontSizePx: 28,
    textColor: "#ffffff",
    strokeColor: "#000000",
    strokeWidthPx: 4,
    offsetY: 0,
  };
}

/**
 * Returns default JPEG encoding strategy with 15 KiB auto-optimization enabled.
 *
 * @returns Immutable initial {@link JpegEncodingConfig}.
 */
export function createDefaultEncodingConfig(): JpegEncodingConfig {
  return {
    autoOptimize: true,
    targetMaxBytes: RECOMMENDED_JPEG_MAX_BYTES,
    manualQuality: 0.86,
  };
}

/**
 * Normalizes any degree measurement into the symmetric editor range `[-180, 180]`.
 *
 * @param degrees - Arbitrary rotation angle in degrees.
 * @returns Normalized angle within `[-180, 180]`.
 */
export function normalizeRotationDeg(degrees: number): number {
  let normalized = ((degrees % 360) + 360) % 360;
  if (normalized > 180) {
    normalized -= 360;
  }
  // Avoid `-0` from floating-point modulo arithmetic
  return Object.is(normalized, -0) ? 0 : normalized;
}

/**
 * Clamps relative zoom factor into the supported interactive editor bounds.
 *
 * @param scale - Candidate relative zoom scale.
 * @returns Clamped scale in `[MIN_RELATIVE_SCALE, MAX_RELATIVE_SCALE]`.
 */
export function clampRelativeScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return 1.0;
  }
  return Math.min(MAX_RELATIVE_SCALE, Math.max(MIN_RELATIVE_SCALE, scale));
}

/**
 * Computes the Cover scale multiplier mapping a source image to fill the target frame.
 *
 * @param sourceWidth - Natural source image width in pixels.
 * @param sourceHeight - Natural source image height in pixels.
 * @param targetWidth - Output frame width in pixels.
 * @param targetHeight - Output frame height in pixels.
 * @returns Linear pixel scale factor where both target edges are completely covered.
 */
export function computeCoverScale(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth = DEFAULT_DISPLAY_SIZE_PX,
  targetHeight = DEFAULT_DISPLAY_SIZE_PX
): number {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return 1.0;
  }
  return Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
}

/**
 * Computes the relative `ImageTransform.scale` needed to fit the entire image inside the frame ("Contain").
 *
 * @param sourceWidth - Natural source image width in pixels.
 * @param sourceHeight - Natural source image height in pixels.
 * @param targetWidth - Output frame width in pixels.
 * @param targetHeight - Output frame height in pixels.
 * @returns Relative multiplier (`containScale / coverScale`) clamped to valid slider bounds.
 */
export function computeContainRelativeScale(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth = DEFAULT_DISPLAY_SIZE_PX,
  targetHeight = DEFAULT_DISPLAY_SIZE_PX
): number {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return 1.0;
  }
  const cover = computeCoverScale(sourceWidth, sourceHeight, targetWidth, targetHeight);
  const contain = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  return clampRelativeScale(contain / cover);
}

/**
 * Loads a user-selected image `File` locally inside the browser using `URL.createObjectURL`.
 *
 * // 意図: 一切のサーバーアップロードや外部通信を行わず、ブラウザ内のメモリのみでデコード・解放する。
 *
 * @param file - Image file selected via `<input type="file">` or drag-and-drop.
 * @returns Loaded `HTMLImageElement` ready for Canvas 2D drawing.
 * @throws {Error} When the file cannot be decoded as a browser-supported image.
 */
export function loadLocalImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to decode image file: ${file.name}`));
    };
    img.src = objectUrl;
  });
}

/**
 * Renders the background fill, aligned source image (if loaded), and optional text overlay
 * onto a target offscreen or export canvas at exact device pixel dimensions.
 *
 * @param canvas - Destination canvas resized to `geometry.width x geometry.height`.
 * @param sourceImage - Optional loaded image positioned with `transform` (`null` draws background + text only).
 * @param transform - Pan, relative zoom, rotation, and background fill parameters.
 * @param textOverlay - Optional text overlay settings rendered above the image.
 * @param geometry - Output dimensions matching the BG02 dial display (`240x240`).
 */
export function renderExportComposition(
  canvas: HTMLCanvasElement,
  sourceImage: HTMLImageElement | null,
  transform: ImageTransform,
  textOverlay: TextOverlayConfig,
  geometry: BadgeTargetGeometry
): void {
  const { width, height } = geometry;
  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context unavailable");
  }

  // 意図: JPEG は透過チャンネルを持たないため、透過 PNG や余白領域が黒潰れしないようユーザー指定の背景色で全面を塗りつぶす。
  ctx.save();
  ctx.fillStyle = transform.backgroundColor;
  ctx.fillRect(0, 0, width, height);

  if (sourceImage && sourceImage.naturalWidth > 0 && sourceImage.naturalHeight > 0) {
    const srcW = sourceImage.naturalWidth;
    const srcH = sourceImage.naturalHeight;
    const effectiveScale = computeCoverScale(srcW, srcH, width, height) * transform.scale;
    const rad = (transform.rotationDeg * Math.PI) / 180;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(width / 2 + transform.offsetX, height / 2 + transform.offsetY);
    ctx.rotate(rad);
    ctx.scale(effectiveScale, effectiveScale);
    ctx.drawImage(sourceImage, -srcW / 2, -srcH / 2, srcW, srcH);
  }
  ctx.restore();

  if (textOverlay.enabled && textOverlay.text.trim().length > 0) {
    drawTextOverlay(ctx, textOverlay, width, height);
  }
}

/**
 * Draws crisp multi-line text with optional high-contrast outline stroke over the badge canvas.
 *
 * @param ctx - Active 2D rendering context.
 * @param overlay - Typography, colors, stroke thickness, and vertical offset configuration.
 * @param width - Canvas width in pixels.
 * @param height - Canvas height in pixels.
 */
function drawTextOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: TextOverlayConfig,
  width: number,
  height: number
): void {
  const lines = overlay.text.split("\n");
  const lineHeight = Math.round(overlay.fontSizePx * 1.18);
  const centerX = width / 2;
  const centerY = height / 2 + overlay.offsetY - ((lines.length - 1) * lineHeight) / 2;

  ctx.save();
  ctx.font = `bold ${overlay.fontSizePx}px ${overlay.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const y = centerY + i * lineHeight;
    if (overlay.strokeWidthPx > 0) {
      ctx.strokeStyle = overlay.strokeColor;
      ctx.lineWidth = overlay.strokeWidthPx;
      ctx.strokeText(line, centerX, y);
    }
    ctx.fillStyle = overlay.textColor;
    ctx.fillText(line, centerX, y);
  }
  ctx.restore();
}

/**
 * Encodes a rendered 2D canvas into raw JPEG bytes at a fixed quality level.
 *
 * @param canvas - Rendered export canvas (`240x240`).
 * @param quality - Lossy JPEG quality factor in `[0.1, 1.0]`.
 * @returns Encoded JPEG byte array.
 * @throws {Error} When browser `toBlob("image/jpeg")` fails to return a buffer.
 */
export async function encodeCanvasToJpegBytes(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Uint8Array> {
  const clampedQuality = Math.min(1.0, Math.max(0.1, quality));
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/jpeg", clampedQuality);
  });
  if (!blob) {
    throw new Error("Canvas JPEG encoding returned null blob");
  }
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Renders the composed badge offscreen, applies either 15 KiB auto-optimization binary search
 * or manual JPEG quality encoding, and validates the generated `SOF0` structure.
 *
 * @param sourceImage - Loaded user image (`null` permitted when intentionally creating a solid/text card).
 * @param transform - Image alignment parameters.
 * @param textOverlay - Optional text overlay settings.
 * @param encoding - Auto-optimize or manual JPEG encoding configuration.
 * @param geometry - Target BG02 display geometry (defaults to `240x240` round).
 * @param reusableExportCanvas - Optional existing offscreen canvas to minimize allocations while dragging.
 * @returns Verified Baseline JPEG binary, final size/quality telemetry, and clean export canvas.
 */
export async function composeAndEncodeBadge(
  sourceImage: HTMLImageElement | null,
  transform: ImageTransform,
  textOverlay: TextOverlayConfig,
  encoding: JpegEncodingConfig,
  geometry: BadgeTargetGeometry = {
    width: DEFAULT_DISPLAY_SIZE_PX,
    height: DEFAULT_DISPLAY_SIZE_PX,
    shape: "round",
  },
  reusableExportCanvas?: HTMLCanvasElement
): Promise<CompositedBadgeResult> {
  const exportCanvas = reusableExportCanvas ?? document.createElement("canvas");
  renderExportComposition(exportCanvas, sourceImage, transform, textOverlay, geometry);

  let selectedBytes: Uint8Array;
  let usedQuality = encoding.manualQuality;

  if (!encoding.autoOptimize) {
    selectedBytes = await encodeCanvasToJpegBytes(exportCanvas, encoding.manualQuality);
  } else {
    // 意図: まず高品質 (0.92) で試みて目標容量以内なら探索を即終了し、超過した場合のみ二分探索で最高画質点を見つける。
    const highBytes = await encodeCanvasToJpegBytes(exportCanvas, AUTO_OPTIMIZE_MAX_QUALITY);
    if (highBytes.length <= encoding.targetMaxBytes) {
      selectedBytes = highBytes;
      usedQuality = AUTO_OPTIMIZE_MAX_QUALITY;
    } else {
      let low = AUTO_OPTIMIZE_MIN_QUALITY;
      let high = AUTO_OPTIMIZE_MAX_QUALITY;
      let bestFittingBytes: Uint8Array | null = null;
      let bestFittingQuality = AUTO_OPTIMIZE_MIN_QUALITY;

      for (let step = 0; step < AUTO_OPTIMIZE_SEARCH_STEPS; step++) {
        const mid = Number(((low + high) / 2).toFixed(3));
        const candidate = await encodeCanvasToJpegBytes(exportCanvas, mid);
        if (candidate.length <= encoding.targetMaxBytes) {
          bestFittingBytes = candidate;
          bestFittingQuality = mid;
          low = mid;
        } else {
          high = mid;
        }
      }

      if (bestFittingBytes) {
        selectedBytes = bestFittingBytes;
        usedQuality = bestFittingQuality;
      } else {
        // 意図: 情報量が極めて多い画像で最低品質でも予算超過する場合でも、結果を返しつつ exceedsTarget 警告を UI に出す。
        selectedBytes = await encodeCanvasToJpegBytes(exportCanvas, AUTO_OPTIMIZE_MIN_QUALITY);
        usedQuality = AUTO_OPTIMIZE_MIN_QUALITY;
      }
    }
  }

  const inspection = inspectJpeg(selectedBytes);
  return {
    jpegBytes: selectedBytes,
    byteLength: selectedBytes.length,
    usedQuality,
    exceedsTarget: selectedBytes.length > encoding.targetMaxBytes,
    inspection,
    exportCanvas,
  };
}

/**
 * Draws the clean export bitmap onto the interactive preview `<canvas>` and overlays circular
 * bezel dimming + safe-area guide lines so the guides never leak into the uploaded JPEG file.
 *
 * @param previewCanvas - Visible UI `<canvas>` element observed by the user.
 * @param exportCanvas - Clean offscreen export bitmap generated by {@link renderExportComposition}.
 * @param shape - Badge display silhouette (`"round"` draws circular mask + safe zone).
 */
export function renderPreviewWithGuides(
  previewCanvas: HTMLCanvasElement,
  exportCanvas: HTMLCanvasElement,
  shape: DisplayShape
): void {
  const width = exportCanvas.width;
  const height = exportCanvas.height;
  if (previewCanvas.width !== width) {
    previewCanvas.width = width;
  }
  if (previewCanvas.height !== height) {
    previewCanvas.height = height;
  }

  const ctx = previewCanvas.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(exportCanvas, 0, 0);

  if (shape !== "round") {
    return;
  }

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 1;

  // 意図: 円形画面の四隅が実機ベゼルで隠れることを直感的に把握できるよう、プレビュー表示のみ外周を半透明減光する。
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.arc(cx, cy, radius, 0, Math.PI * 2, true);
  ctx.fillStyle = "rgba(2, 6, 23, 0.72)";
  ctx.fill();

  // Outer bezel edge highlight
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Inner safe-area guide ring (~88% diameter)
  ctx.beginPath();
  ctx.setLineDash([4, 4]);
  ctx.arc(cx, cy, radius * 0.88, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(248, 250, 252, 0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}
