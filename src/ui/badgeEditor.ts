/**
 * @module ui/badgeEditor
 * Screen 2 (`activeScreen === "editor"`): Focused circular photo crop & text studio.
 * Keeps primary visual controls prominent (circular preview, Change Photo, Rotate,
 * Text toggle, conditional Reset, and Next -> Send CTA) while tucking fine sliders
 * and JPEG encoding diagnostics inside collapsed native `<details>` accordions.
 */

import { interpolate } from "../i18n/i18n";
import type { TranslationSchema } from "../i18n/types";
import {
  AVAILABLE_FONT_FAMILIES,
  MAX_RELATIVE_SCALE,
  MIN_RELATIVE_SCALE,
  clampRelativeScale,
  createDefaultTransform,
  hasPublishableBadgeContent,
  normalizeRotationDeg,
} from "../imaging/badgeCompositor";
import { isUploadableJpeg } from "../imaging/jpegInspector";
import type { ImageTransform, JpegEncodingConfig, TextOverlayConfig } from "../imaging/types";
import type { AppStateSnapshot } from "../state/appStore";
import {
  createButton,
  createEl,
  createIconButton,
  type IconButtonHandle,
} from "./domHelpers";
import { createStudioIcon } from "./icons";

/** Vertical preset offsets (`px` from center) for quick Top / Center / Bottom text placement. */
export const TEXT_PRESET_OFFSETS = {
  /** Upper safe band of the 240×240 circle. */
  TOP: -66,
  /** Vertical center. */
  CENTER: 0,
  /** Lower safe band of the 240×240 circle. */
  BOTTOM: 66,
} as const;

const NUDGE_STEP_PX = 8;
const KEYBOARD_NUDGE_PX = 6;
const KEYBOARD_SHIFT_NUDGE_PX = 18;

/** Tracked pointer coordinate on {@link BadgeEditor.previewCanvas}. */
export interface ActiveCanvasPointer {
  /** Viewport X coordinate in CSS pixels. */
  clientX: number;
  /** Viewport Y coordinate in CSS pixels. */
  clientY: number;
}

/** Captured multi-touch or mouse baseline snapshot at the start of a pan/pinch gesture. */
export interface CanvasGestureBaseline {
  /** Number of active pointers (`1` = pan, `2` = pinch + pan). */
  readonly pointerCount: 1 | 2;
  /** Starting pointer or midpoint X coordinate in CSS pixels. */
  readonly startX: number;
  /** Starting pointer or midpoint Y coordinate in CSS pixels. */
  readonly startY: number;
  /** Euclidean finger spread (CSS pixels) captured for 2-finger pinch gestures. */
  readonly startPinchDistance: number;
  /** Canvas `offsetX` snapshot when gesture phase began. */
  readonly baseOffsetX: number;
  /** Canvas `offsetY` snapshot when gesture phase began. */
  readonly baseOffsetY: number;
  /** Transform `scale` snapshot when gesture phase began. */
  readonly baseScale: number;
}

/** Callbacks invoked by {@link BadgeEditor} interactions. */
export interface BadgeEditorHandlers {
  /** Returns to Screen 1 (`"home"`). */
  readonly onBackHome: () => void;
  /** Opens file picker or accepts a dropped local photo file. */
  readonly onPickPhoto: () => void;
  /** Handles local file dropped onto the circular canvas frame. */
  readonly onDropImageFile: (file: File) => void;
  /** Updates placement, zoom, rotation, or background fill fields. */
  readonly onChangeTransform: (patch: Partial<ImageTransform>) => void;
  /** Fits photo cleanly across the 240×240 frame (`Cover`). */
  readonly onFitCover: () => void;
  /** Fits the full source frame inside the 240×240 canvas (`Contain`). */
  readonly onFitContain: () => void;
  /** Rotates image by 90° (`-90` or `+90`). */
  readonly onRotateStep: (deltaDeg: number) => void;
  /** Resets offset, zoom, rotation, and background fill to default. */
  readonly onResetTransform: () => void;
  /** Opens or collapses the inline badge text input card without clearing typed text. */
  readonly onToggleTextEditor: (open: boolean) => void;
  /** Updates baked-in text overlay settings. */
  readonly onChangeTextOverlay: (patch: Partial<TextOverlayConfig>) => void;
  /** Updates JPEG encoding strategy or manual quality factor. */
  readonly onChangeEncoding: (patch: Partial<JpegEncodingConfig>) => void;
  /** Proceeds from Editor to Screen 3 (`"send"`). */
  readonly onNextSend: () => void;
  /** Exports verified Baseline JPEG locally to disk. */
  readonly onDownloadJpeg: () => void;
}

/** Handle exposing a labeled range slider and live value readout. */
export interface RangeControlHandle {
  /** Outer wrapper container. */
  readonly root: HTMLDivElement;
  /** Field label. */
  readonly labelEl: HTMLLabelElement;
  /** Formatted numeric readout. */
  readonly valueEl: HTMLSpanElement;
  /** Interactive `<input type="range">`. */
  readonly inputEl: HTMLInputElement;
}

/** Spec passed to {@link createRangeControl}. */
export interface RangeControlSpec {
  /** Unique HTML `id` linking `<label>` and `<input>`. */
  readonly id: string;
  /** Initial localized label. */
  readonly labelText: string;
  /** Minimum value. */
  readonly min: number;
  /** Maximum value. */
  readonly max: number;
  /** Step increment. */
  readonly step: number;
  /** Initial numeric value. */
  readonly initialValue: number;
  /** Numeric readout formatter. */
  readonly formatValue: (val: number) => string;
  /** Input change handler. */
  readonly onInput: (val: number) => void;
}

/**
 * Builds an accessible labeled slider with tabular numeric readout.
 *
 * @param spec - Slider configuration and formatter.
 * @returns Slider handle.
 */
export function createRangeControl(spec: RangeControlSpec): RangeControlHandle {
  const labelEl = createEl("label", {
    text: spec.labelText,
    attrs: { for: spec.id },
  });
  const valueEl = createEl("span", {
    className: "field-value",
    text: spec.formatValue(spec.initialValue),
  });
  const labelRow = createEl("div", { className: "field-label-row" }, [labelEl, valueEl]);
  const inputEl = createEl("input", {
    id: spec.id,
    attrs: {
      type: "range",
      min: String(spec.min),
      max: String(spec.max),
      step: String(spec.step),
      value: String(spec.initialValue),
    },
  });

  inputEl.addEventListener("input", () => {
    const parsed = Number(inputEl.value);
    valueEl.textContent = spec.formatValue(parsed);
    spec.onInput(parsed);
  });

  const root = createEl("div", { className: "field-group" }, [labelRow, inputEl]);
  return { root, labelEl, valueEl, inputEl };
}

function isTransformAdjusted(t: ImageTransform): boolean {
  const def = createDefaultTransform();
  return (
    Math.abs(t.offsetX) > 0.5 ||
    Math.abs(t.offsetY) > 0.5 ||
    Math.abs(t.scale - def.scale) > 0.005 ||
    Math.abs(t.rotationDeg - def.rotationDeg) > 0.5 ||
    t.backgroundColor.toLowerCase() !== def.backgroundColor.toLowerCase()
  );
}

/**
 * Renders Screen 2 (`"editor"`): Photos, Crop, Zoom, Rotation & Text Studio.
 */
export class BadgeEditor {
  /** Root container for Screen 2. */
  public readonly element: HTMLElement;
  /** Explicit `< ホーム` button exposed for non-scrolling focus placement. */
  public readonly backBtn: HTMLButtonElement;
  /** Interactive 240×240 circular badge canvas. */
  public readonly previewCanvas: HTMLCanvasElement;
  /** Text overlay `<input>` exposed so Home `"文字だけで作る"` focuses it smoothly. */
  public readonly textInputEl: HTMLInputElement;

  /** Active localized translation dictionary. */
  private dict: TranslationSchema;
  /** Most recent rendered store snapshot for gesture clamps. */
  private latestSnapshot: AppStateSnapshot | null = null;
  /** Callback handlers supplied by the application coordinator. */
  private readonly handlers: BadgeEditorHandlers;

  /** Active pointer coordinates keyed by pointer ID for pinch/drag gestures. */
  private readonly activePointers = new Map<number, ActiveCanvasPointer>();
  /** Initial geometry snapshot recorded at the start of a pointer gesture. */
  private gestureBaseline: CanvasGestureBaseline | null = null;

  /** Top bar heading element for the editor screen. */
  private readonly topTitleEl: HTMLHeadingElement;
  /** Text span inside the top back navigation button. */
  private readonly backBtnLabelEl: HTMLSpanElement;

  /** Dropzone wrapper container around the circular badge preview canvas. */
  private readonly dropzoneWrapEl: HTMLDivElement;
  /** Full-canvas overlay button inviting photo selection when empty. */
  private readonly emptyTapOverlayBtn: HTMLButtonElement;
  /** Label inside the empty-canvas overlay button. */
  private readonly emptyTapTextEl: HTMLSpanElement;
  /** Helper caption displayed below the circular preview canvas. */
  private readonly canvasHintEl: HTMLParagraphElement;
  /** Polite live region announcing background image encoding updates. */
  private readonly asyncStatusEl: HTMLDivElement;
  /** Inline alert banner shown when loading or encoding an image fails. */
  private readonly errorAlertEl: HTMLDivElement;
  /** Text span inside the editor image error alert banner. */
  private readonly errorAlertTextEl: HTMLSpanElement;

  /** Primary toolbar button to pick or replace the photo. */
  private readonly changePhotoBtn: IconButtonHandle;
  /** Toolbar button rotating the image by 90 degrees clockwise. */
  private readonly rotate90Btn: IconButtonHandle;
  /** Toolbar button toggling the text overlay card. */
  private readonly toggleTextBtn: IconButtonHandle;
  /** Toolbar button resetting transform and text adjustments. */
  private readonly resetAdjustBtn: IconButtonHandle;
  /** Toolbar button stepping canvas zoom down. */
  private readonly zoomOutBtn: IconButtonHandle;
  /** Toolbar button stepping canvas zoom up. */
  private readonly zoomInBtn: IconButtonHandle;

  /** Collapsible card housing text overlay controls. */
  private readonly textCardEl: HTMLDivElement;
  /** Heading for the text overlay card. */
  private readonly textCardTitleEl: HTMLHeadingElement;
  /** Label associated with the overlay text input. */
  private readonly textInputLabelEl: HTMLLabelElement;
  /** Button clearing and closing the text overlay. */
  private readonly removeTextBtn: HTMLButtonElement;
  /** Accordion summary for expanded text styling options. */
  private readonly textStyleSummaryEl: HTMLElement;
  /** Group label for text vertical position presets. */
  private readonly posPresetLabelEl: HTMLSpanElement;
  /** Preset button aligning overlay text near the top edge. */
  private readonly posTopBtn: HTMLButtonElement;
  /** Preset button centering overlay text vertically. */
  private readonly posCenterBtn: HTMLButtonElement;
  /** Preset button aligning overlay text near the bottom edge. */
  private readonly posBottomBtn: HTMLButtonElement;

  /** Label associated with the font family selector. */
  private readonly fontLabelEl: HTMLLabelElement;
  /** Font family `<select>` element for overlay text. */
  private readonly fontSelectEl: HTMLSelectElement;
  /** Range slider controlling overlay font size. */
  private readonly fontSizeRange: RangeControlHandle;
  /** Label for the overlay text fill color picker. */
  private readonly textColorLabelEl: HTMLLabelElement;
  /** Color picker input for overlay text fill color. */
  private readonly textColorInputEl: HTMLInputElement;
  /** Label for the overlay text stroke outline color picker. */
  private readonly strokeColorLabelEl: HTMLLabelElement;
  /** Color picker input for overlay text outline color. */
  private readonly strokeColorInputEl: HTMLInputElement;
  /** Range slider controlling overlay text outline thickness. */
  private readonly strokeWidthRange: RangeControlHandle;
  /** Range slider shifting overlay text vertically. */
  private readonly textOffsetYRange: RangeControlHandle;

  /** Accordion summary for fine transform sliders and canvas fill. */
  private readonly fineAdjustSummaryEl: HTMLElement;
  /** Button fitting the image to fill the entire circular mask. */
  private readonly fitCoverBtn: IconButtonHandle;
  /** Button fitting the entire image inside the circular mask. */
  private readonly fitContainBtn: IconButtonHandle;
  /** Button rotating the image slightly counter-clockwise. */
  private readonly rotateLeftBtn: IconButtonHandle;
  /** Button rotating the image slightly clockwise. */
  private readonly rotateRightBtn: IconButtonHandle;
  /** Button nudging the image slightly left. */
  private readonly moveLeftBtn: IconButtonHandle;
  /** Button nudging the image slightly up. */
  private readonly moveUpBtn: IconButtonHandle;
  /** Button nudging the image slightly down. */
  private readonly moveDownBtn: IconButtonHandle;
  /** Button nudging the image slightly right. */
  private readonly moveRightBtn: IconButtonHandle;
  /** Range slider controlling horizontal offset. */
  private readonly offsetXRange: RangeControlHandle;
  /** Range slider controlling vertical offset. */
  private readonly offsetYRange: RangeControlHandle;
  /** Range slider controlling continuous zoom scale. */
  private readonly scaleRange: RangeControlHandle;
  /** Range slider controlling free rotation angle in degrees. */
  private readonly rotationRange: RangeControlHandle;
  /** Label for the circular canvas background fill color input. */
  private readonly bgColorLabelEl: HTMLLabelElement;
  /** Color picker input for uncovered background regions. */
  private readonly bgColorInputEl: HTMLInputElement;

  /** Accordion summary for JPEG compression and byte-budget details. */
  private readonly outputDetailsSummaryEl: HTMLElement;
  /** Checkbox label for automatic 60 KB size optimization. */
  private readonly autoOptimizeLabelEl: HTMLLabelElement;
  /** Checkbox toggling automatic quality adjustment under the BLE byte limit. */
  private readonly autoOptimizeCheckboxEl: HTMLInputElement;
  /** Range slider for manual JPEG quality when auto-optimize is off. */
  private readonly manualQualityRange: RangeControlHandle;
  /** Paragraph showing the encoded JPEG byte size and limit. */
  private readonly outputSizeTextEl: HTMLParagraphElement;
  /** Status pill summarizing SOF0 / JPEG header validation results. */
  private readonly sofValidationPillEl: HTMLDivElement;

  /** Prompt shown when no image or text has been created yet. */
  private readonly needContentHintEl: HTMLParagraphElement;
  /** Primary footer button advancing from the editor to the send screen. */
  private readonly nextSendBtn: IconButtonHandle;
  /** Secondary footer button downloading the encoded badge JPEG locally. */
  private readonly saveJpegBtn: IconButtonHandle;

  /**
   * Builds Screen 2 DOM structure and binds touch/mouse/keyboard/slider controls.
   *
   * @param initialDict - Active localized translation schema.
   * @param handlers - Editor interaction callbacks.
   */
  public constructor(initialDict: TranslationSchema, handlers: BadgeEditorHandlers) {
    this.dict = initialDict;
    this.handlers = handlers;

    const backIcon = createStudioIcon("arrowLeft", 18);
    this.backBtnLabelEl = createEl("span", { text: initialDict.editor.btnBackHome });
    this.backBtn = createEl("button", { className: "screen-back-btn" }, [
      backIcon,
      this.backBtnLabelEl,
    ]);
    this.backBtn.type = "button";
    this.backBtn.addEventListener("click", handlers.onBackHome);

    this.topTitleEl = createEl("h1", {
      className: "screen-top-title",
      text: initialDict.editor.screenTitle,
    });
    const topBar = createEl("div", { className: "screen-top-bar" }, [
      this.backBtn,
      this.topTitleEl,
      createEl("span", { className: "screen-top-spacer", attrs: { "aria-hidden": "true" } }),
    ]);

    this.errorAlertTextEl = createEl("span", { text: "" });
    this.errorAlertEl = createEl(
      "div",
      { className: "inline-alert", attrs: { role: "alert", "data-tone": "err" } },
      [createStudioIcon("alert", 18), this.errorAlertTextEl]
    );
    this.errorAlertEl.hidden = true;

    this.previewCanvas = createEl("canvas", {
      className: "badge-preview-canvas",
      attrs: {
        width: "240",
        height: "240",
        tabindex: "0",
        role: "application",
        "aria-label": initialDict.editor.previewCanvasAriaLabel,
      },
    });
    this.emptyTapTextEl = createEl("span", {
      className: "canvas-empty-text",
      text: initialDict.editor.emptyCirclePrompt,
    });
    this.emptyTapOverlayBtn = createEl("button", { className: "canvas-empty-overlay" }, [
      createStudioIcon("photo", 28),
      this.emptyTapTextEl,
    ]);
    this.emptyTapOverlayBtn.type = "button";
    this.emptyTapOverlayBtn.addEventListener("click", handlers.onPickPhoto);

    this.dropzoneWrapEl = createEl("div", { className: "canvas-stage-ring" }, [
      this.previewCanvas,
      this.emptyTapOverlayBtn,
    ]);
    this.canvasHintEl = createEl("p", {
      className: "canvas-hint",
      text: initialDict.editor.canvasInteractionHint,
    });
    this.asyncStatusEl = createEl("div", {
      className: "editor-async-status",
      attrs: { role: "status", "aria-live": "polite" },
    });
    this.asyncStatusEl.hidden = true;

    // Quick primary controls above/beside editor panel
    this.changePhotoBtn = createIconButton(
      "btn btn-secondary",
      "photo",
      initialDict.editor.btnChangePhoto,
      18
    );
    this.rotate90Btn = createIconButton(
      "btn btn-secondary",
      "rotateCw",
      initialDict.editor.btnRotate90,
      18
    );
    this.toggleTextBtn = createIconButton(
      "btn btn-secondary",
      "text",
      initialDict.editor.btnAddText,
      18
    );
    this.resetAdjustBtn = createIconButton(
      "btn btn-ghost",
      "reset",
      initialDict.editor.btnResetAdjust,
      18
    );
    this.resetAdjustBtn.button.hidden = true;

    this.zoomOutBtn = createIconButton(
      "btn btn-secondary btn-icon-compact",
      "zoomOut",
      initialDict.editor.btnZoomOut,
      18
    );
    this.zoomInBtn = createIconButton(
      "btn btn-secondary btn-icon-compact",
      "zoomIn",
      initialDict.editor.btnZoomIn,
      18
    );

    this.changePhotoBtn.button.addEventListener("click", handlers.onPickPhoto);
    this.rotate90Btn.button.addEventListener("click", () => handlers.onRotateStep(90));
    this.toggleTextBtn.button.addEventListener("click", () => {
      const currentlyOpen = Boolean(this.latestSnapshot?.textEditorOpen);
      const nextOpen = !currentlyOpen;
      handlers.onToggleTextEditor(nextOpen);
      if (nextOpen) {
        queueMicrotask(() => this.textInputEl.focus({ preventScroll: true }));
      }
    });
    this.resetAdjustBtn.button.addEventListener("click", handlers.onResetTransform);
    this.zoomOutBtn.button.addEventListener("click", () => {
      const current = this.latestSnapshot?.transform.scale ?? 1;
      handlers.onChangeTransform({ scale: clampRelativeScale(current - 0.15) });
    });
    this.zoomInBtn.button.addEventListener("click", () => {
      const current = this.latestSnapshot?.transform.scale ?? 1;
      handlers.onChangeTransform({ scale: clampRelativeScale(current + 0.15) });
    });

    const quickRow = createEl("div", { className: "editor-quick-row" }, [
      this.changePhotoBtn.button,
      this.rotate90Btn.button,
      this.toggleTextBtn.button,
    ]);

    const previewColumn = createEl("div", { className: "editor-preview-col" }, [
      this.errorAlertEl,
      this.dropzoneWrapEl,
      this.canvasHintEl,
      this.asyncStatusEl,
      quickRow,
    ]);

    // Conditional Text Input & collapsed Text Style <details>
    this.textCardTitleEl = createEl("h2", {
      className: "card-section-title",
      text: initialDict.editor.textSectionTitle,
    });
    this.textInputLabelEl = createEl("label", {
      text: initialDict.editor.labelOverlayText,
      attrs: { for: "editor-text-overlay-input" },
    });
    this.textInputEl = createEl("input", {
      id: "editor-text-overlay-input",
      className: "text-input",
      attrs: {
        type: "text",
        maxlength: "48",
        placeholder: initialDict.editor.textPlaceholder,
      },
    });
    this.textInputEl.addEventListener("input", () => {
      const hasText = this.textInputEl.value.trim().length > 0;
      handlers.onChangeTextOverlay({
        enabled: hasText,
        text: this.textInputEl.value,
      });
    });

    this.removeTextBtn = createButton("btn btn-sm btn-ghost", initialDict.editor.btnRemoveText);
    this.removeTextBtn.addEventListener("click", () => {
      handlers.onChangeTextOverlay({ enabled: false, text: "" });
      handlers.onToggleTextEditor(false);
    });

    const textHeaderRow = createEl("div", { className: "card-header-inline" }, [
      this.textCardTitleEl,
      this.removeTextBtn,
    ]);

    this.posPresetLabelEl = createEl("span", {
      className: "field-sub-label",
      text: initialDict.editor.labelTextPositionPreset,
    });
    this.posTopBtn = createButton("btn btn-sm btn-secondary", initialDict.editor.posTop);
    this.posCenterBtn = createButton("btn btn-sm btn-secondary", initialDict.editor.posCenter);
    this.posBottomBtn = createButton("btn btn-sm btn-secondary", initialDict.editor.posBottom);
    this.posTopBtn.addEventListener("click", () =>
      handlers.onChangeTextOverlay({ offsetY: TEXT_PRESET_OFFSETS.TOP })
    );
    this.posCenterBtn.addEventListener("click", () =>
      handlers.onChangeTextOverlay({ offsetY: TEXT_PRESET_OFFSETS.CENTER })
    );
    this.posBottomBtn.addEventListener("click", () =>
      handlers.onChangeTextOverlay({ offsetY: TEXT_PRESET_OFFSETS.BOTTOM })
    );

    const posPresetRow = createEl("div", { className: "preset-pill-row" }, [
      this.posTopBtn,
      this.posCenterBtn,
      this.posBottomBtn,
    ]);

    this.fontLabelEl = createEl("label", {
      text: initialDict.editor.labelFontFamily,
      attrs: { for: "editor-text-font-select" },
    });
    this.fontSelectEl = createEl("select", {
      id: "editor-text-font-select",
      className: "select-input",
    });
    for (const font of AVAILABLE_FONT_FAMILIES) {
      const opt = createEl("option", { text: font.label, attrs: { value: font.value } });
      this.fontSelectEl.appendChild(opt);
    }
    this.fontSelectEl.addEventListener("change", () => {
      handlers.onChangeTextOverlay({ fontFamily: this.fontSelectEl.value });
    });

    this.fontSizeRange = createRangeControl({
      id: "editor-font-size",
      labelText: initialDict.editor.labelFontSize,
      min: 14,
      max: 56,
      step: 1,
      initialValue: 26,
      formatValue: (v) => `${v} px`,
      onInput: (v) => handlers.onChangeTextOverlay({ fontSizePx: v }),
    });

    this.textColorLabelEl = createEl("label", {
      text: initialDict.editor.labelTextColor,
      attrs: { for: "editor-text-color" },
    });
    this.textColorInputEl = createEl("input", {
      id: "editor-text-color",
      className: "color-input",
      attrs: { type: "color", value: "#ffffff" },
    });
    this.textColorInputEl.addEventListener("input", () =>
      handlers.onChangeTextOverlay({ textColor: this.textColorInputEl.value })
    );

    this.strokeColorLabelEl = createEl("label", {
      text: initialDict.editor.labelStrokeColor,
      attrs: { for: "editor-stroke-color" },
    });
    this.strokeColorInputEl = createEl("input", {
      id: "editor-stroke-color",
      className: "color-input",
      attrs: { type: "color", value: "#000000" },
    });
    this.strokeColorInputEl.addEventListener("input", () =>
      handlers.onChangeTextOverlay({ strokeColor: this.strokeColorInputEl.value })
    );

    const colorRow = createEl("div", { className: "color-picker-grid" }, [
      createEl("div", { className: "color-picker-item" }, [
        this.textColorLabelEl,
        this.textColorInputEl,
      ]),
      createEl("div", { className: "color-picker-item" }, [
        this.strokeColorLabelEl,
        this.strokeColorInputEl,
      ]),
    ]);

    this.strokeWidthRange = createRangeControl({
      id: "editor-stroke-width",
      labelText: initialDict.editor.labelStrokeWidth,
      min: 0,
      max: 8,
      step: 0.5,
      initialValue: 3,
      formatValue: (v) => `${v} px`,
      onInput: (v) => handlers.onChangeTextOverlay({ strokeWidthPx: v }),
    });
    this.textOffsetYRange = createRangeControl({
      id: "editor-text-offset-y",
      labelText: initialDict.editor.labelTextOffsetY,
      min: -100,
      max: 100,
      step: 2,
      initialValue: 64,
      formatValue: (v) => `${v > 0 ? "+" : ""}${v} px`,
      onInput: (v) => handlers.onChangeTextOverlay({ offsetY: v }),
    });

    this.textStyleSummaryEl = createEl("summary", {}, [
      createEl("span", { text: initialDict.editor.textStyleDetailsSummary }),
    ]);
    const textStyleDetails = createEl("details", { className: "editor-details" }, [
      this.textStyleSummaryEl,
      createEl("div", { className: "details-body" }, [
        this.posPresetLabelEl,
        posPresetRow,
        createEl("div", { className: "field-group" }, [this.fontLabelEl, this.fontSelectEl]),
        this.fontSizeRange.root,
        colorRow,
        this.strokeWidthRange.root,
        this.textOffsetYRange.root,
      ]),
    ]);

    this.textCardEl = createEl("div", { className: "surface-card editor-text-card" }, [
      textHeaderRow,
      this.textInputLabelEl,
      this.textInputEl,
      textStyleDetails,
    ]);
    this.textCardEl.hidden = true;

    // Collapsed Fine Adjustment <details>
    this.fitCoverBtn = createIconButton(
      "btn btn-sm btn-secondary",
      "cover",
      initialDict.editor.btnFitCover,
      16
    );
    this.fitContainBtn = createIconButton(
      "btn btn-sm btn-secondary",
      "contain",
      initialDict.editor.btnFitContain,
      16
    );
    this.rotateLeftBtn = createIconButton(
      "btn btn-sm btn-secondary",
      "rotateCcw",
      initialDict.editor.btnRotateLeft,
      16
    );
    this.rotateRightBtn = createIconButton(
      "btn btn-sm btn-secondary",
      "rotateCw",
      initialDict.editor.btnRotateRight,
      16
    );
    this.fitCoverBtn.button.addEventListener("click", handlers.onFitCover);
    this.fitContainBtn.button.addEventListener("click", handlers.onFitContain);
    this.rotateLeftBtn.button.addEventListener("click", () => handlers.onRotateStep(-90));
    this.rotateRightBtn.button.addEventListener("click", () => handlers.onRotateStep(90));

    this.moveLeftBtn = createIconButton(
      "btn btn-sm btn-secondary",
      "arrowLeft",
      initialDict.editor.btnMoveLeft,
      16
    );
    this.moveUpBtn = createIconButton(
      "btn btn-sm btn-secondary",
      "arrowUp",
      initialDict.editor.btnMoveUp,
      16
    );
    this.moveDownBtn = createIconButton(
      "btn btn-sm btn-secondary",
      "arrowDown",
      initialDict.editor.btnMoveDown,
      16
    );
    this.moveRightBtn = createIconButton(
      "btn btn-sm btn-secondary",
      "arrowLeft",
      initialDict.editor.btnMoveRight,
      16
    );
    this.moveRightBtn.button.classList.add("icon-flip-x");
    const nudgeBy = (dx: number, dy: number): void => {
      const t = this.latestSnapshot?.transform;
      if (!t) return;
      handlers.onChangeTransform({
        offsetX: Math.max(-180, Math.min(180, Math.round(t.offsetX + dx))),
        offsetY: Math.max(-180, Math.min(180, Math.round(t.offsetY + dy))),
      });
    };
    this.moveLeftBtn.button.addEventListener("click", () => nudgeBy(-NUDGE_STEP_PX, 0));
    this.moveUpBtn.button.addEventListener("click", () => nudgeBy(0, -NUDGE_STEP_PX));
    this.moveDownBtn.button.addEventListener("click", () => nudgeBy(0, NUDGE_STEP_PX));
    this.moveRightBtn.button.addEventListener("click", () => nudgeBy(NUDGE_STEP_PX, 0));

    const zoomResetRow = createEl("div", { className: "fine-btn-row" }, [
      this.zoomOutBtn.button,
      this.zoomInBtn.button,
      this.resetAdjustBtn.button,
    ]);
    const fitRow = createEl("div", { className: "fine-btn-row" }, [
      this.fitCoverBtn.button,
      this.fitContainBtn.button,
      this.rotateLeftBtn.button,
      this.rotateRightBtn.button,
    ]);
    const nudgeRow = createEl("div", { className: "fine-btn-row" }, [
      this.moveLeftBtn.button,
      this.moveUpBtn.button,
      this.moveDownBtn.button,
      this.moveRightBtn.button,
    ]);

    this.offsetXRange = createRangeControl({
      id: "editor-offset-x",
      labelText: initialDict.editor.labelOffsetX,
      min: -180,
      max: 180,
      step: 1,
      initialValue: 0,
      formatValue: (v) => `${v > 0 ? "+" : ""}${Math.round(v)} px`,
      onInput: (v) => handlers.onChangeTransform({ offsetX: v }),
    });
    this.offsetYRange = createRangeControl({
      id: "editor-offset-y",
      labelText: initialDict.editor.labelOffsetY,
      min: -180,
      max: 180,
      step: 1,
      initialValue: 0,
      formatValue: (v) => `${v > 0 ? "+" : ""}${Math.round(v)} px`,
      onInput: (v) => handlers.onChangeTransform({ offsetY: v }),
    });
    this.scaleRange = createRangeControl({
      id: "editor-scale",
      labelText: initialDict.editor.labelScale,
      min: MIN_RELATIVE_SCALE,
      max: MAX_RELATIVE_SCALE,
      step: 0.02,
      initialValue: 1,
      formatValue: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => handlers.onChangeTransform({ scale: v }),
    });
    this.rotationRange = createRangeControl({
      id: "editor-rotation",
      labelText: initialDict.editor.labelRotation,
      min: -180,
      max: 180,
      step: 1,
      initialValue: 0,
      formatValue: (v) => `${Math.round(v)}°`,
      onInput: (v) => handlers.onChangeTransform({ rotationDeg: normalizeRotationDeg(v) }),
    });

    this.bgColorLabelEl = createEl("label", {
      text: initialDict.editor.labelBgColor,
      attrs: { for: "editor-bg-color" },
    });
    this.bgColorInputEl = createEl("input", {
      id: "editor-bg-color",
      className: "color-input",
      attrs: { type: "color", value: createDefaultTransform().backgroundColor },
    });
    this.bgColorInputEl.addEventListener("input", () =>
      handlers.onChangeTransform({ backgroundColor: this.bgColorInputEl.value })
    );

    this.fineAdjustSummaryEl = createEl("summary", {}, [
      createEl("span", { text: initialDict.editor.fineAdjustSummary }),
    ]);
    const fineAdjustDetails = createEl("details", { className: "editor-details surface-card" }, [
      this.fineAdjustSummaryEl,
      createEl("div", { className: "details-body" }, [
        zoomResetRow,
        fitRow,
        nudgeRow,
        this.offsetXRange.root,
        this.offsetYRange.root,
        this.scaleRange.root,
        this.rotationRange.root,
        createEl("div", { className: "color-picker-item" }, [
          this.bgColorLabelEl,
          this.bgColorInputEl,
        ]),
      ]),
    ]);

    // Collapsed File format & Output Details <details>
    this.autoOptimizeLabelEl = createEl("label", {
      text: initialDict.editor.labelAutoOptimize,
      attrs: { for: "editor-auto-optimize" },
    });
    this.autoOptimizeCheckboxEl = createEl("input", {
      id: "editor-auto-optimize",
      className: "toggle-checkbox",
      attrs: { type: "checkbox" },
    });
    this.autoOptimizeCheckboxEl.checked = true;
    this.autoOptimizeCheckboxEl.addEventListener("change", () =>
      handlers.onChangeEncoding({ autoOptimize: this.autoOptimizeCheckboxEl.checked })
    );

    this.manualQualityRange = createRangeControl({
      id: "editor-manual-quality",
      labelText: initialDict.editor.labelManualQuality,
      min: 0.2,
      max: 0.98,
      step: 0.02,
      initialValue: 0.85,
      formatValue: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => handlers.onChangeEncoding({ manualQuality: v }),
    });
    this.outputSizeTextEl = createEl("p", { className: "output-size-readout", text: "" });
    this.sofValidationPillEl = createEl("div", { className: "inline-alert", text: "" });

    this.outputDetailsSummaryEl = createEl("summary", {}, [
      createEl("span", { text: initialDict.editor.outputDetailsSummary }),
    ]);
    const outputDetails = createEl("details", { className: "editor-details surface-card" }, [
      this.outputDetailsSummaryEl,
      createEl("div", { className: "details-body" }, [
        createEl("div", { className: "checkbox-row" }, [
          this.autoOptimizeCheckboxEl,
          this.autoOptimizeLabelEl,
        ]),
        this.manualQualityRange.root,
        this.outputSizeTextEl,
        this.sofValidationPillEl,
      ]),
    ]);

    // Bottom CTA Bar
    this.needContentHintEl = createEl("p", {
      className: "editor-need-content-hint",
      text: initialDict.editor.needContentHint,
    });
    this.nextSendBtn = createIconButton(
      "btn btn-primary btn-cta-large",
      "send",
      initialDict.editor.btnNextSend,
      18
    );
    this.saveJpegBtn = createIconButton(
      "btn btn-secondary",
      "download",
      initialDict.editor.btnSaveJpeg,
      18
    );
    this.nextSendBtn.button.addEventListener("click", handlers.onNextSend);
    this.saveJpegBtn.button.addEventListener("click", handlers.onDownloadJpeg);

    const ctaFooterCard = createEl("div", { className: "surface-card editor-cta-card" }, [
      this.needContentHintEl,
      createEl("div", { className: "editor-cta-buttons" }, [
        this.nextSendBtn.button,
        this.saveJpegBtn.button,
      ]),
    ]);

    const controlsColumn = createEl("div", { className: "editor-controls-col" }, [
      ctaFooterCard,
      this.textCardEl,
      fineAdjustDetails,
      outputDetails,
    ]);

    const workspaceGrid = createEl("div", { className: "editor-workspace" }, [
      previewColumn,
      controlsColumn,
    ]);

    this.element = createEl(
      "section",
      {
        id: "screen-editor",
        className: "screen-view editor-screen",
        attrs: { "aria-label": initialDict.editor.screenTitle },
      },
      [topBar, workspaceGrid]
    );

    this.wireCanvasGestures();
    this.wireDropzone();
  }

  /**
   * Synchronizes translated labels across Screen 2 and updates rendered values.
   *
   * @param nextDict - Updated translation schema.
   * @param state - Latest store snapshot.
   */
  public updateLocale(nextDict: TranslationSchema, state: AppStateSnapshot): void {
    this.dict = nextDict;
    const e = nextDict.editor;
    this.element.setAttribute("aria-label", e.screenTitle);
    this.topTitleEl.textContent = e.screenTitle;
    this.backBtnLabelEl.textContent = e.btnBackHome;
    this.previewCanvas.setAttribute("aria-label", e.previewCanvasAriaLabel);
    this.emptyTapTextEl.textContent = e.emptyCirclePrompt;
    this.canvasHintEl.textContent = e.canvasInteractionHint;

    this.changePhotoBtn.labelEl.textContent = e.btnChangePhoto;
    this.rotate90Btn.labelEl.textContent = e.btnRotate90;
    this.resetAdjustBtn.labelEl.textContent = e.btnResetAdjust;
    this.zoomOutBtn.labelEl.textContent = e.btnZoomOut;
    this.zoomInBtn.labelEl.textContent = e.btnZoomIn;

    this.textCardTitleEl.textContent = e.textSectionTitle;
    this.textInputLabelEl.textContent = e.labelOverlayText;
    this.textInputEl.placeholder = e.textPlaceholder;
    this.removeTextBtn.textContent = e.btnRemoveText;
    this.textStyleSummaryEl.firstElementChild!.textContent = e.textStyleDetailsSummary;
    this.posPresetLabelEl.textContent = e.labelTextPositionPreset;
    this.posTopBtn.textContent = e.posTop;
    this.posCenterBtn.textContent = e.posCenter;
    this.posBottomBtn.textContent = e.posBottom;
    this.fontLabelEl.textContent = e.labelFontFamily;
    this.fontSizeRange.labelEl.textContent = e.labelFontSize;
    this.textColorLabelEl.textContent = e.labelTextColor;
    this.strokeColorLabelEl.textContent = e.labelStrokeColor;
    this.strokeWidthRange.labelEl.textContent = e.labelStrokeWidth;
    this.textOffsetYRange.labelEl.textContent = e.labelTextOffsetY;

    this.fineAdjustSummaryEl.firstElementChild!.textContent = e.fineAdjustSummary;
    this.fitCoverBtn.labelEl.textContent = e.btnFitCover;
    this.fitContainBtn.labelEl.textContent = e.btnFitContain;
    this.rotateLeftBtn.labelEl.textContent = e.btnRotateLeft;
    this.rotateRightBtn.labelEl.textContent = e.btnRotateRight;
    this.moveLeftBtn.labelEl.textContent = e.btnMoveLeft;
    this.moveUpBtn.labelEl.textContent = e.btnMoveUp;
    this.moveDownBtn.labelEl.textContent = e.btnMoveDown;
    this.moveRightBtn.labelEl.textContent = e.btnMoveRight;
    this.offsetXRange.labelEl.textContent = e.labelOffsetX;
    this.offsetYRange.labelEl.textContent = e.labelOffsetY;
    this.scaleRange.labelEl.textContent = e.labelScale;
    this.rotationRange.labelEl.textContent = e.labelRotation;
    this.bgColorLabelEl.textContent = e.labelBgColor;

    this.outputDetailsSummaryEl.firstElementChild!.textContent = e.outputDetailsSummary;
    this.autoOptimizeLabelEl.textContent = e.labelAutoOptimize;
    this.manualQualityRange.labelEl.textContent = e.labelManualQuality;
    this.needContentHintEl.textContent = e.needContentHint;
    this.nextSendBtn.labelEl.textContent = e.btnNextSend;
    this.saveJpegBtn.labelEl.textContent = e.btnSaveJpeg;

    this.render(state);
  }

  /**
   * Updates all Editor controls, empty canvas overlay, loading/encoding feedback,
   * conditional Reset button, text sheet visibility, JPEG validation, and Send CTA enablement.
   *
   * @param state - Latest store snapshot.
   */
  public render(state: AppStateSnapshot): void {
    this.latestSnapshot = state;
    const e = this.dict.editor;
    const hasPhoto = Boolean(state.sourceMeta);
    const hasContent = hasPublishableBadgeContent(hasPhoto, state.textOverlay);

    if (state.imageLoadError) {
      this.errorAlertEl.hidden = false;
      this.errorAlertTextEl.textContent = state.imageLoadError;
    } else {
      this.errorAlertEl.hidden = true;
    }

    if (state.isLoadingImage) {
      this.asyncStatusEl.hidden = false;
      this.asyncStatusEl.textContent = e.loadingPhotoStatus;
    } else if (state.isEncodingDraft) {
      this.asyncStatusEl.hidden = false;
      this.asyncStatusEl.textContent = e.encodingDraftStatus;
    } else {
      this.asyncStatusEl.hidden = true;
    }

    this.emptyTapOverlayBtn.hidden =
      hasPhoto || state.textOverlay.enabled || state.textEditorOpen;
    this.rotate90Btn.button.disabled = !hasPhoto || state.isLoadingImage;
    this.rotateLeftBtn.button.disabled = !hasPhoto;
    this.rotateRightBtn.button.disabled = !hasPhoto;
    this.fitCoverBtn.button.disabled = !hasPhoto;
    this.fitContainBtn.button.disabled = !hasPhoto;
    this.zoomOutBtn.button.disabled = !hasPhoto;
    this.zoomInBtn.button.disabled = !hasPhoto;

    const hasTextContent = state.textOverlay.text.trim().length > 0;
    this.toggleTextBtn.labelEl.textContent = state.textEditorOpen
      ? e.btnHideText
      : hasTextContent
        ? e.btnEditText
        : e.btnAddText;
    this.toggleTextBtn.button.setAttribute("aria-expanded", String(state.textEditorOpen));
    this.toggleTextBtn.button.setAttribute("aria-pressed", String(state.textEditorOpen));

    const defaultBg = createDefaultTransform().backgroundColor.toLowerCase();
    const adjusted = isTransformAdjusted(state.transform);
    this.resetAdjustBtn.button.hidden =
      !adjusted || (!hasPhoto && state.transform.backgroundColor.toLowerCase() === defaultBg);

    // Text overlay card visibility & field sync
    this.textCardEl.hidden = !state.textEditorOpen;
    if (document.activeElement !== this.textInputEl) {
      this.textInputEl.value = state.textOverlay.text;
    }
    this.fontSelectEl.value = state.textOverlay.fontFamily;
    this.fontSizeRange.inputEl.value = String(state.textOverlay.fontSizePx);
    this.fontSizeRange.valueEl.textContent = `${state.textOverlay.fontSizePx} px`;
    this.textColorInputEl.value = state.textOverlay.textColor;
    this.strokeColorInputEl.value = state.textOverlay.strokeColor;
    this.strokeWidthRange.inputEl.value = String(state.textOverlay.strokeWidthPx);
    this.strokeWidthRange.valueEl.textContent = `${state.textOverlay.strokeWidthPx} px`;
    this.textOffsetYRange.inputEl.value = String(state.textOverlay.offsetY);
    this.textOffsetYRange.valueEl.textContent = `${state.textOverlay.offsetY > 0 ? "+" : ""}${state.textOverlay.offsetY} px`;

    // Transform sliders
    this.offsetXRange.inputEl.value = String(Math.round(state.transform.offsetX));
    this.offsetXRange.valueEl.textContent = `${state.transform.offsetX > 0 ? "+" : ""}${Math.round(state.transform.offsetX)} px`;
    this.offsetYRange.inputEl.value = String(Math.round(state.transform.offsetY));
    this.offsetYRange.valueEl.textContent = `${state.transform.offsetY > 0 ? "+" : ""}${Math.round(state.transform.offsetY)} px`;
    this.scaleRange.inputEl.value = String(state.transform.scale);
    this.scaleRange.valueEl.textContent = `${Math.round(state.transform.scale * 100)}%`;
    this.rotationRange.inputEl.value = String(Math.round(state.transform.rotationDeg));
    this.rotationRange.valueEl.textContent = `${Math.round(state.transform.rotationDeg)}°`;
    this.bgColorInputEl.value = state.transform.backgroundColor;

    // Output / Encoding details
    this.autoOptimizeCheckboxEl.checked = state.encoding.autoOptimize;
    this.manualQualityRange.inputEl.disabled = state.encoding.autoOptimize;
    this.manualQualityRange.inputEl.value = String(state.encoding.manualQuality);
    this.manualQualityRange.valueEl.textContent = `${Math.round(state.encoding.manualQuality * 100)}%`;

    const out = state.latestOutput;
    if (out) {
      const kb = (out.byteLength / 1024).toFixed(1);
      const qPct = Math.round(out.usedQuality * 100);
      this.outputSizeTextEl.textContent = interpolate(e.outputSizeSummary, {
        kb,
        bytes: out.byteLength.toLocaleString(),
        quality: qPct,
      });

      const targetW = state.metadata?.dialInfo?.width ?? 240;
      const targetH = state.metadata?.dialInfo?.height ?? 240;
      const info = out.inspection;
      this.sofValidationPillEl.hidden = false;
      if (info.markerType === "SOF2" || info.errorCode === "progressive_sof2") {
        this.sofValidationPillEl.setAttribute("data-tone", "err");
        this.sofValidationPillEl.textContent = e.errorProgressiveSof2;
      } else if (!info.valid) {
        this.sofValidationPillEl.setAttribute("data-tone", "err");
        this.sofValidationPillEl.textContent = e.errorInvalidJpeg;
      } else if (!isUploadableJpeg(info, targetW, targetH)) {
        this.sofValidationPillEl.setAttribute("data-tone", "err");
        this.sofValidationPillEl.textContent = interpolate(e.errorDimensionMismatch, {
          w: info.width ?? 0,
          h: info.height ?? 0,
          tw: targetW,
          th: targetH,
        });
      } else if (out.exceedsTarget) {
        this.sofValidationPillEl.setAttribute("data-tone", "warn");
        this.sofValidationPillEl.textContent = e.warnExceedsTarget;
      } else {
        this.sofValidationPillEl.setAttribute("data-tone", "ok");
        this.sofValidationPillEl.textContent = interpolate(e.validationSof0Ok, {
          w: info.width ?? targetW,
          h: info.height ?? targetH,
        });
      }
    } else {
      this.outputSizeTextEl.textContent = "";
      this.sofValidationPillEl.hidden = true;
    }

    this.needContentHintEl.hidden = hasContent;
    this.nextSendBtn.button.disabled = !hasContent || state.isLoadingImage;
    this.saveJpegBtn.button.disabled = !hasContent || state.isLoadingImage;
  }

  /** Attaches drag-and-drop file handlers onto the preview dropzone container. */
  private wireDropzone(): void {
    this.dropzoneWrapEl.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      this.dropzoneWrapEl.classList.add("is-dragover");
    });
    this.dropzoneWrapEl.addEventListener("dragleave", () => {
      this.dropzoneWrapEl.classList.remove("is-dragover");
    });
    this.dropzoneWrapEl.addEventListener("drop", (ev) => {
      ev.preventDefault();
      this.dropzoneWrapEl.classList.remove("is-dragover");
      const file = ev.dataTransfer?.files?.[0];
      if (file) {
        this.handlers.onDropImageFile(file);
      }
    });
  }

  /** Wires pointer pan/pinch, wheel zoom, and arrow-key nudge gestures on the preview canvas. */
  private wireCanvasGestures(): void {
    const captureBaseline = (): void => {
      const state = this.latestSnapshot;
      if (!state) return;
      const pts = [...this.activePointers.values()];
      if (pts.length === 1) {
        this.gestureBaseline = {
          pointerCount: 1,
          startX: pts[0].clientX,
          startY: pts[0].clientY,
          startPinchDistance: 0,
          baseOffsetX: state.transform.offsetX,
          baseOffsetY: state.transform.offsetY,
          baseScale: state.transform.scale,
        };
      } else if (pts.length >= 2) {
        const [a, b] = pts;
        this.gestureBaseline = {
          pointerCount: 2,
          startX: (a.clientX + b.clientX) / 2,
          startY: (a.clientY + b.clientY) / 2,
          startPinchDistance: Math.max(10, Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)),
          baseOffsetX: state.transform.offsetX,
          baseOffsetY: state.transform.offsetY,
          baseScale: state.transform.scale,
        };
      } else {
        this.gestureBaseline = null;
      }
    };

    this.previewCanvas.addEventListener("pointerdown", (ev) => {
      if (!this.latestSnapshot?.sourceMeta) return;
      this.previewCanvas.setPointerCapture(ev.pointerId);
      this.activePointers.set(ev.pointerId, { clientX: ev.clientX, clientY: ev.clientY });
      captureBaseline();
    });

    this.previewCanvas.addEventListener("pointermove", (ev) => {
      if (!this.activePointers.has(ev.pointerId) || !this.gestureBaseline) return;
      this.activePointers.set(ev.pointerId, { clientX: ev.clientX, clientY: ev.clientY });
      const rect = this.previewCanvas.getBoundingClientRect();
      const pxRatio = rect.width > 0 ? 240 / rect.width : 1;
      const pts = [...this.activePointers.values()];

      if (this.gestureBaseline.pointerCount === 1 && pts.length === 1) {
        const dx = (pts[0].clientX - this.gestureBaseline.startX) * pxRatio;
        const dy = (pts[0].clientY - this.gestureBaseline.startY) * pxRatio;
        this.handlers.onChangeTransform({
          offsetX: Math.max(-180, Math.min(180, Math.round(this.gestureBaseline.baseOffsetX + dx))),
          offsetY: Math.max(-180, Math.min(180, Math.round(this.gestureBaseline.baseOffsetY + dy))),
        });
      } else if (pts.length >= 2) {
        if (this.gestureBaseline.pointerCount !== 2) {
          captureBaseline();
          return;
        }
        const [a, b] = pts;
        const midX = (a.clientX + b.clientX) / 2;
        const midY = (a.clientY + b.clientY) / 2;
        const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        const scaleFactor = dist / this.gestureBaseline.startPinchDistance;
        const dx = (midX - this.gestureBaseline.startX) * pxRatio;
        const dy = (midY - this.gestureBaseline.startY) * pxRatio;
        this.handlers.onChangeTransform({
          scale: clampRelativeScale(this.gestureBaseline.baseScale * scaleFactor),
          offsetX: Math.max(-180, Math.min(180, Math.round(this.gestureBaseline.baseOffsetX + dx))),
          offsetY: Math.max(-180, Math.min(180, Math.round(this.gestureBaseline.baseOffsetY + dy))),
        });
      }
    });

    const releasePointer = (ev: PointerEvent): void => {
      if (this.previewCanvas.hasPointerCapture(ev.pointerId)) {
        this.previewCanvas.releasePointerCapture(ev.pointerId);
      }
      this.activePointers.delete(ev.pointerId);
      captureBaseline();
    };
    this.previewCanvas.addEventListener("pointerup", releasePointer);
    this.previewCanvas.addEventListener("pointercancel", releasePointer);

    this.previewCanvas.addEventListener(
      "wheel",
      (ev) => {
        if (!this.latestSnapshot?.sourceMeta) return;
        ev.preventDefault();
        const factor = ev.deltaY < 0 ? 1.08 : 0.92;
        this.handlers.onChangeTransform({
          scale: clampRelativeScale(this.latestSnapshot.transform.scale * factor),
        });
      },
      { passive: false }
    );

    this.previewCanvas.addEventListener("keydown", (ev) => {
      const t = this.latestSnapshot?.transform;
      if (!t || !this.latestSnapshot?.sourceMeta) return;
      const step = ev.shiftKey ? KEYBOARD_SHIFT_NUDGE_PX : KEYBOARD_NUDGE_PX;
      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        this.handlers.onChangeTransform({ offsetX: Math.max(-180, t.offsetX - step) });
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        this.handlers.onChangeTransform({ offsetX: Math.min(180, t.offsetX + step) });
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        this.handlers.onChangeTransform({ offsetY: Math.max(-180, t.offsetY - step) });
      } else if (ev.key === "ArrowDown") {
        ev.preventDefault();
        this.handlers.onChangeTransform({ offsetY: Math.min(180, t.offsetY + step) });
      } else if (ev.key === "+" || ev.key === "=") {
        ev.preventDefault();
        this.handlers.onChangeTransform({ scale: clampRelativeScale(t.scale + 0.1) });
      } else if (ev.key === "-" || ev.key === "_") {
        ev.preventDefault();
        this.handlers.onChangeTransform({ scale: clampRelativeScale(t.scale - 0.1) });
      }
    });
  }
}
