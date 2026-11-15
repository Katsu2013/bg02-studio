/**
 * @module ui/badgeEditor
 * Renders Panel 2 split cleanly into a mobile-first consumer canvas studio (`element`)
 * with 1-finger pan / 2-finger pinch zoom and one-tap preset pills, plus a developer
 * precision/JPEG verification card (`advancedElement`) tucked inside the bottom drawer.
 */

import type { TranslationSchema } from "../i18n/types";
import { interpolate } from "../i18n/i18n";
import {
  AVAILABLE_FONT_FAMILIES,
  MAX_RELATIVE_SCALE,
  MIN_RELATIVE_SCALE,
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
  /** Places text near the upper safe band of the 240×240 circle. */
  TOP: -66,
  /** Places text directly in the vertical center. */
  CENTER: 0,
  /** Places text near the lower safe band of the 240×240 circle. */
  BOTTOM: 66,
} as const;

/** Callbacks invoked by {@link BadgeEditor} when user manipulates files, transforms, or upload actions. */
export interface BadgeEditorHandlers {
  /** Navigates back from the Image Push view to Screen 1 (`"home"`). */
  readonly onBack: () => void;
  /** Called when the user selects or drops a local image file. */
  readonly onSelectImageFile: (file: File) => void;
  /** Called when any placement/zoom/rotation/background transform field changes. */
  readonly onChangeTransform: (patch: Partial<ImageTransform>) => void;
  /** Fits the loaded source image cleanly to fill the circular/square frame ("Cover"). */
  readonly onFitCover: () => void;
  /** Fits the entire loaded image cleanly inside the frame ("Contain"). */
  readonly onFitContain: () => void;
  /** Rotates the source image cleanly in 90° increments. */
  readonly onRotateStep: (deltaDeg: number) => void;
  /** Restores default alignment (`offsetX=0, offsetY=0, scale=1, rotation=0`). */
  readonly onResetTransform: () => void;
  /** Updates optional text overlay fields. */
  readonly onChangeTextOverlay: (patch: Partial<TextOverlayConfig>) => void;
  /** Updates JPEG encoding strategy or manual quality factor. */
  readonly onChangeEncoding: (patch: Partial<JpegEncodingConfig>) => void;
  /** Saves the generated `240x240` Baseline JPEG locally to disk. */
  readonly onDownloadJpeg: () => void;
  /** Initiates BLE WatchTheme3 upload of the verified Baseline JPEG to BG02. */
  readonly onUploadToDevice: () => void;
  /** Refreshes device storage and telemetry from the connected BG02 badge. */
  readonly onRefreshTelemetry: () => void;
}

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

/** References to a reusable labeled `<input type="range">` widget created via {@link createRangeControl}. */
export interface RangeControlHandle {
  /** Outer wrapper container placed inside a CSS grid. */
  readonly root: HTMLDivElement;
  /** Label text node updated on locale changes. */
  readonly labelEl: HTMLLabelElement;
  /** Numeric readout text next to the label. */
  readonly valueEl: HTMLSpanElement;
  /** Interactive range `<input>` control. */
  readonly inputEl: HTMLInputElement;
}

/** Configuration arguments passed to {@link createRangeControl}. */
export interface RangeControlSpec {
  /** Unique HTML element `id` linking `<label>` and `<input>`. */
  readonly id: string;
  /** Initial localized field label text. */
  readonly labelText: string;
  /** Minimum slider value. */
  readonly min: number;
  /** Maximum slider value. */
  readonly max: number;
  /** Slider step increment. */
  readonly step: number;
  /** Initial numeric value. */
  readonly initialValue: number;
  /** Formatter converting raw numeric value to concise readout (`e.g. +12 px`). */
  readonly formatValue: (val: number) => string;
  /** Callback invoked on every live slider movement. */
  readonly onInput: (val: number) => void;
}

/**
 * Constructs a reusable, accessible labeled range slider paired with a tabular numeric readout.
 *
 * @param spec - Slider bounds, formatting callback, and change handler.
 * @returns Handle exposing label, live readout span, and input element.
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

/**
 * Stateful DOM controller separating the SuperBand-inspired circular badge studio (`element`)
 * from collapsible alignment (`fineAlignElement`) and JPEG export (`exportElement`) panels.
 */
export class BadgeEditor {
  /** Full Screen 2 (`"push"`) wrapper containing top bar, stage card, and responsive tools column. */
  public readonly screenElement: HTMLElement;
  /** Explicit `<` Back button exposed for non-scrolling focus placement after drill-down. */
  public readonly backBtn: HTMLButtonElement;
  /** Primary consumer badge studio card. */
  public readonly element: HTMLElement;
  /** Fine X/Y/scale/rotation and text-stroke controls mounted in the Alignment accordion. */
  public readonly fineAlignElement: HTMLElement;
  /** JPEG optimization toggles, byte-budget pills, and local download mounted in Export accordion. */
  public readonly exportElement: HTMLElement;
  /** Visible interactive 240×240 preview `<canvas>` displaying circular safe guides. */
  public readonly previewCanvas: HTMLCanvasElement;
  /** Top bar centered push screen heading. */
  private readonly pushTopTitleEl: HTMLHeadingElement;
  /** Top bar compact status pill showing active badge + battery or offline mode. */
  private readonly deviceStatusPillEl: HTMLSpanElement;
  /** Accordion title span inside Fine Alignment `<summary>`. */
  private readonly alignSummaryTitleEl: HTMLSpanElement;
  /** Accordion title span inside JPEG Export `<summary>`. */
  private readonly exportSummaryTitleEl: HTMLSpanElement;
  /** Short reminder caption explaining >= 20% battery and unplugged requirement. */
  private readonly ruleReminderEl: HTMLParagraphElement;
  /** Drag-and-drop canvas wrapper box. */
  private readonly dropzoneWrapEl: HTMLDivElement;
  /** Soft periwinkle/light-blue circular ring frame around the badge canvas. */
  private readonly bezelRingEl: HTMLDivElement;
  /** Visually hidden native file input triggered cleanly by gallery/empty-ring clicks. */
  private readonly fileInputEl: HTMLInputElement;
  /** Visually hidden mobile camera capture file input (`capture="environment"`). */
  private readonly cameraInputEl: HTMLInputElement;
  /** Floating tap-to-pick button shown over empty canvas until photo/text is added. */
  private readonly emptyCanvasTapBtn: IconButtonHandle;
  /** Centered output size caption directly under the circular preview (`Crop size: 9.9 KB`). */
  private readonly cropSizeCaptionEl: HTMLParagraphElement;
  /** Inline remaining device flash readout + compact `Refresh` pill button. */
  private readonly remainingRowEl: HTMLDivElement;
  /** Device remaining space text inside `remainingRowEl`. */
  private readonly remainingTextEl: HTMLSpanElement;
  /** Compact blue pill button querying free storage from the linked BG02 badge. */
  private readonly refreshStorageBtn: HTMLButtonElement;
  /** Heading (`Select Image`) placed above the pastel Camera/Gallery action tiles. */
  private readonly selectImageHeadingEl: HTMLHeadingElement;
  /** Pastel amber tile button launching mobile camera capture / file picker. */
  private readonly quickCameraBtn: HTMLButtonElement;
  /** Localized text label under `quickCameraBtn`. */
  private readonly quickCameraLabelEl: HTMLSpanElement;
  /** Pastel lilac tile button picking a local image file. */
  private readonly quickPickBtn: HTMLButtonElement;
  /** Localized text label under `quickPickBtn`. */
  private readonly quickPickLabelEl: HTMLSpanElement;
  /** Consumer file info / status caption below quick controls. */
  private readonly fileSummaryEl: HTMLParagraphElement;
  /** Concise consumer touch/drag hint caption. */
  private readonly canvasHintEl: HTMLParagraphElement;
  /** Quick action bar button filling the circle ("Cover"). */
  private readonly quickCoverBtn: IconButtonHandle;
  /** Quick action bar button fitting whole image ("Contain"). */
  private readonly quickContainBtn: IconButtonHandle;
  /** Quick action bar button rotating +90°. */
  private readonly quickRotateBtn: IconButtonHandle;
  /** Quick action bar button toggling the lightweight inline text sheet. */
  private readonly quickTextToggleBtn: IconButtonHandle;
  /** Quick action bar button resetting position/zoom/rotation. */
  private readonly quickResetBtn: IconButtonHandle;
  /** Label wrapper for quick compact background color picker chip. */
  private readonly quickBgChipLabel: HTMLLabelElement;
  /** Text label span inside `quickBgChipLabel`. */
  private readonly quickBgChipText: HTMLSpanElement;
  /** Compact background color picker in the consumer quick bar. */
  private readonly quickBgColorInput: HTMLInputElement;
  /** Collapsible inline consumer text editor sheet toggled via `quickTextToggleBtn`. */
  private readonly textSheetEl: HTMLDivElement;
  /** Checkbox toggling text rendering. */
  private readonly enableTextCheckbox: HTMLInputElement;
  /** Label span for `enableTextCheckbox`. */
  private readonly enableTextLabelSpan: HTMLSpanElement;
  /** Motivation tip explaining why text baking avoids device mojibake. */
  private readonly textTipEl: HTMLParagraphElement;
  /** Label for overlay text `<textarea>`. */
  private readonly overlayTextLabel: HTMLLabelElement;
  /** Multi-line text overlay textarea. */
  private readonly overlayTextInput: HTMLTextAreaElement;
  /** Label for quick vertical position preset buttons. */
  private readonly posPresetLabelEl: HTMLSpanElement;
  /** Preset button aligning text to top safe band. */
  private readonly posTopBtn: HTMLButtonElement;
  /** Preset button centering text vertically. */
  private readonly posCenterBtn: HTMLButtonElement;
  /** Preset button aligning text to bottom safe band. */
  private readonly posBottomBtn: HTMLButtonElement;
  /** Label for font-family `<select>`. */
  private readonly fontFamilyLabel: HTMLLabelElement;
  /** Font-family `<select>` control. */
  private readonly fontFamilySelect: HTMLSelectElement;
  /** Text size slider inside inline text sheet. */
  private readonly fontSizeCtrl: RangeControlHandle;
  /** Label for text fill color picker. */
  private readonly textColorLabel: HTMLLabelElement;
  /** Text fill color picker. */
  private readonly textColorInput: HTMLInputElement;
  /** Label for text outline color picker. */
  private readonly strokeColorLabel: HTMLLabelElement;
  /** Text outline color picker. */
  private readonly strokeColorInput: HTMLInputElement;
  /** Primary consumer full-width button initiating WatchTheme3 BLE transfer. */
  private readonly uploadBtn: IconButtonHandle;
  /** Upload progress bar displayed beneath the primary Send button while active. */
  private readonly progressEl: HTMLProgressElement;
  /** Friendly helper caption shown under disabled Send button when disconnected. */
  private readonly connectHintEl: HTMLParagraphElement;
  /** Developer card subheading (`<h3>`) for fine numeric controls. */
  private readonly groupAlignHeading: HTMLHeadingElement;
  /** Developer-only X pan slider. */
  private readonly offsetXCtrl: RangeControlHandle;
  /** Developer-only Y pan slider. */
  private readonly offsetYCtrl: RangeControlHandle;
  /** Developer-only zoom scale slider. */
  private readonly scaleCtrl: RangeControlHandle;
  /** Developer-only rotation angle slider. */
  private readonly rotationCtrl: RangeControlHandle;
  /** Developer-only fine outline stroke width slider. */
  private readonly strokeWidthCtrl: RangeControlHandle;
  /** Developer-only fine text Y offset slider. */
  private readonly textOffsetYCtrl: RangeControlHandle;
  /** Developer-only Rotate -90° button. */
  private readonly devRotateLeftBtn: IconButtonHandle;
  /** Developer card subheading (`<h3>`) for JPEG auto-optimization & inspection. */
  private readonly groupExportHeading: HTMLHeadingElement;
  /** Checkbox toggling <= 15 KiB auto-optimization (developer drawer). */
  private readonly autoOptCheckbox: HTMLInputElement;
  /** Label span next to `autoOptCheckbox`. */
  private readonly autoOptLabelSpan: HTMLSpanElement;
  /** Manual JPEG quality slider (developer drawer). */
  private readonly manualQualityCtrl: RangeControlHandle;
  /** Metric badge reporting encoded JPEG byte length and effective quality (developer drawer). */
  private readonly sizePill: HTMLSpanElement;
  /** Metric badge reporting `SOF0` / `SOF2` / dimension verification verdict (developer drawer). */
  private readonly inspectionPill: HTMLSpanElement;
  /** Warning pill shown when output exceeds 15 KiB budget (developer drawer). */
  private readonly sizeWarnPill: HTMLSpanElement;
  /** Local JPEG download button placed in the developer/advanced panel. */
  private readonly downloadBtn: IconButtonHandle;
  /** Active translation dictionary. */
  private dict: TranslationSchema;
  /** Latest synced transform snapshot used during multi-touch pinch/pan baseline updates. */
  private latestTransform: ImageTransform;
  /** Whether the lightweight inline text sheet is currently expanded. */
  private textSheetOpen = false;
  /** Active pointers touching/dragging on {@link previewCanvas}. */
  private readonly activePointers = new Map<number, ActiveCanvasPointer>();
  /** Current gesture start snapshot recomputed whenever pointer count changes. */
  private gestureBaseline: CanvasGestureBaseline | null = null;

  /**
   * Builds the circular badge studio (`element`), alignment panel (`fineAlignElement`),
   * and JPEG export card (`exportElement`).
   *
   * @param initialDict - Active initial localization dictionary.
   * @param initialState - Initial immutable application state snapshot.
   * @param handlers - Coordinator callbacks executing image & BLE operations.
   */
  public constructor(
    initialDict: TranslationSchema,
    initialState: AppStateSnapshot,
    handlers: BadgeEditorHandlers
  ) {
    this.dict = initialDict;
    this.latestTransform = initialState.transform;

    // 1. Hidden native gallery & camera choosers
    this.fileInputEl = createEl("input", {
      id: "badge-image-file",
      className: "file-input-hidden",
      attrs: { type: "file", accept: "image/*" },
    });
    this.fileInputEl.addEventListener("change", () => {
      const file = this.fileInputEl.files?.[0];
      if (file) {
        handlers.onSelectImageFile(file);
        this.fileInputEl.value = "";
      }
    });

    this.cameraInputEl = createEl("input", {
      id: "badge-camera-file",
      className: "file-input-hidden",
      attrs: { type: "file", accept: "image/*", capture: "environment" },
    });
    this.cameraInputEl.addEventListener("change", () => {
      const file = this.cameraInputEl.files?.[0];
      if (file) {
        handlers.onSelectImageFile(file);
        this.cameraInputEl.value = "";
      }
    });

    // 2. SuperBand-inspired Clean Circular Showcase Ring + Floating Empty CTA
    this.previewCanvas = createEl("canvas", {
      id: "badge-preview-canvas",
      className: "badge-preview-canvas",
      attrs: {
        width: "240",
        height: "240",
        tabindex: "0",
        role: "img",
        "aria-label": initialDict.editor.previewCanvasAriaLabel,
      },
    });
    this.emptyCanvasTapBtn = createIconButton(
      "btn btn-primary canvas-empty-cta",
      "photo",
      initialDict.editor.emptyCanvasTapLabel,
      16
    );
    this.emptyCanvasTapBtn.button.addEventListener("click", () => this.fileInputEl.click());

    const screenPortEl = createEl("div", { className: "badge-screen-port" }, [
      this.previewCanvas,
      this.emptyCanvasTapBtn.button,
    ]);
    this.bezelRingEl = createEl(
      "div",
      {
        className: "badge-ring-frame",
        attrs: { "data-shape": "round", "data-empty": "true" },
      },
      [screenPortEl]
    );

    this.dropzoneWrapEl = createEl(
      "div",
      {
        className: "dropzone-canvas-wrap",
        attrs: { "aria-label": initialDict.editor.dropzonePrompt },
      },
      [this.fileInputEl, this.cameraInputEl, this.bezelRingEl]
    );
    this.wireDropzone(handlers);
    this.wireCanvasGestures(handlers);

    this.cropSizeCaptionEl = createEl("p", {
      className: "crop-size-caption",
      text: interpolate(initialDict.editor.cropSizeSummary, { kb: "0.0" }),
    });

    // 3. Prominent Pill-Shaped Upload Button directly beneath Circle + Size
    this.uploadBtn = createIconButton("btn btn-primary btn-upload-pill", "send", initialDict.editor.btnUpload, 17);
    this.uploadBtn.button.addEventListener("click", () => handlers.onUploadToDevice());

    this.progressEl = createEl("progress", {
      className: "upload-progress",
      attrs: { max: "100", value: "0", hidden: "" },
    });
    this.ruleReminderEl = createEl("p", {
      className: "hint-caption push-rule-note",
      text: initialDict.editor.pushRuleReminder,
    });
    this.connectHintEl = createEl("p", {
      className: "hint-caption",
      text: initialDict.editor.connectFirstHint,
    });

    // 4. Device remaining space + Refresh pill row (shown cleanly once linked)
    this.remainingTextEl = createEl("span", {
      className: "remaining-space-text",
      text: interpolate(initialDict.editor.remainingSpaceSummary, {
        space: initialDict.connection.valueNotRead,
      }),
    });
    this.refreshStorageBtn = createButton("btn-refresh-pill", initialDict.editor.btnRefreshShort);
    this.refreshStorageBtn.addEventListener("click", () => handlers.onRefreshTelemetry());
    this.remainingRowEl = createEl(
      "div",
      { className: "remaining-space-row", attrs: { hidden: "" } },
      [this.remainingTextEl, this.refreshStorageBtn]
    );

    // 5. Pastel Select-Image Icon Tiles (Camera + Gallery) + Compact Quick Framing Strip
    this.selectImageHeadingEl = createEl("h2", {
      className: "section-subhead",
      text: initialDict.editor.sectionSelectImage,
    });
    this.quickCameraLabelEl = createEl("span", {
      className: "pastel-tile-label",
      text: initialDict.editor.btnTakePhoto,
    });
    this.quickCameraBtn = createEl("button", { className: "pastel-tile-btn", attrs: { type: "button" } }, [
      createEl(
        "span",
        { className: "pastel-tile-icon", attrs: { "data-pastel": "amber", "aria-hidden": "true" } },
        [createStudioIcon("camera", 20)]
      ),
      this.quickCameraLabelEl,
    ]);
    this.quickCameraBtn.addEventListener("click", () => this.cameraInputEl.click());

    this.quickPickLabelEl = createEl("span", {
      className: "pastel-tile-label",
      text: initialDict.editor.btnSelectFile,
    });
    this.quickPickBtn = createEl("button", { className: "pastel-tile-btn", attrs: { type: "button" } }, [
      createEl(
        "span",
        { className: "pastel-tile-icon", attrs: { "data-pastel": "lilac", "aria-hidden": "true" } },
        [createStudioIcon("photo", 20)]
      ),
      this.quickPickLabelEl,
    ]);
    this.quickPickBtn.addEventListener("click", () => this.fileInputEl.click());

    const pastelTilesRow = createEl("div", { className: "pastel-tiles-row" }, [
      this.quickCameraBtn,
      this.quickPickBtn,
    ]);

    this.quickCoverBtn = createIconButton("btn btn-sm seg-btn", "cover", initialDict.editor.quickBtnCover, 14);
    this.quickContainBtn = createIconButton("btn btn-sm seg-btn", "contain", initialDict.editor.quickBtnContain, 14);
    this.quickRotateBtn = createIconButton("btn btn-sm", "rotateCw", initialDict.editor.quickBtnRotate, 14);
    this.quickTextToggleBtn = createIconButton("btn btn-sm", "text", initialDict.editor.quickBtnText, 14);
    this.quickTextToggleBtn.button.setAttribute("aria-pressed", "false");
    this.quickTextToggleBtn.button.setAttribute("aria-expanded", "false");
    this.quickResetBtn = createIconButton("btn btn-sm", "reset", initialDict.editor.quickBtnReset, 14);

    this.quickBgColorInput = createEl("input", {
      id: "color-bg-fill",
      attrs: { type: "color", value: initialState.transform.backgroundColor },
    });
    this.quickBgChipText = createEl("span", { text: initialDict.editor.labelBgColor });
    this.quickBgChipLabel = createEl(
      "label",
      { className: "color-chip-label color-chip-sm", attrs: { for: "color-bg-fill" } },
      [this.quickBgChipText, this.quickBgColorInput]
    );

    this.quickCoverBtn.button.addEventListener("click", () => handlers.onFitCover());
    this.quickContainBtn.button.addEventListener("click", () => handlers.onFitContain());
    this.quickRotateBtn.button.addEventListener("click", () => handlers.onRotateStep(90));
    this.quickResetBtn.button.addEventListener("click", () => handlers.onResetTransform());
    this.quickBgColorInput.addEventListener("input", () => {
      handlers.onChangeTransform({ backgroundColor: this.quickBgColorInput.value });
    });
    this.quickTextToggleBtn.button.addEventListener("click", () => {
      this.textSheetOpen = !this.textSheetOpen;
      this.textSheetEl.hidden = !this.textSheetOpen;
      this.quickTextToggleBtn.button.setAttribute("aria-expanded", String(this.textSheetOpen));
      // 意図: 意図しない上書きを避けるため明示トグルは残し、ボタン状態だけを視覚反映する。
      this.syncTextButtonPressed(this.textSheetOpen || this.enableTextCheckbox.checked);
    });

    const fitSegmentedGroup = createEl("div", { className: "tool-segmented" }, [
      this.quickCoverBtn.button,
      this.quickContainBtn.button,
    ]);
    const quickToolbar = createEl("div", { className: "quick-toolbar" }, [
      fitSegmentedGroup,
      this.quickRotateBtn.button,
      this.quickTextToggleBtn.button,
      this.quickBgChipLabel,
      this.quickResetBtn.button,
    ]);

    this.canvasHintEl = createEl("p", {
      className: "hint-caption",
      text: initialDict.editor.canvasInteractionHint,
    });
    this.fileSummaryEl = createEl("p", {
      className: "hint-caption file-summary-pill",
      text: initialDict.editor.noImageLoaded,
    });

    // 4. Lightweight Inline Text Sheet (toggled by Quick "Text" button)
    this.enableTextCheckbox = createEl("input", {
      id: "opt-enable-text",
      attrs: { type: "checkbox" },
    });
    this.enableTextLabelSpan = createEl("span", { text: initialDict.editor.labelEnableText });
    this.enableTextCheckbox.addEventListener("change", () => {
      handlers.onChangeTextOverlay({ enabled: this.enableTextCheckbox.checked });
    });
    const enableTextRow = createEl(
      "label",
      { className: "check-row", attrs: { for: "opt-enable-text" } },
      [this.enableTextCheckbox, this.enableTextLabelSpan]
    );

    this.textTipEl = createEl("p", {
      className: "tip-note",
      text: initialDict.editor.textMotivationTip,
    });

    this.overlayTextLabel = createEl("label", {
      text: initialDict.editor.labelOverlayText,
      attrs: { for: "input-overlay-text" },
    });
    this.overlayTextInput = createEl("textarea", {
      id: "input-overlay-text",
      attrs: { rows: "2" },
    });
    this.overlayTextInput.value = initialState.textOverlay.text;
    this.overlayTextInput.addEventListener("input", () => {
      // 意図: 一般ユーザーがテキスト欄へ直接入力を始めた場合、自動で文字オーバーレイを ON にすると直感的になる。
      const autoEnable = this.overlayTextInput.value.trim().length > 0;
      handlers.onChangeTextOverlay({
        text: this.overlayTextInput.value,
        enabled: autoEnable ? true : this.enableTextCheckbox.checked,
      });
    });

    this.posPresetLabelEl = createEl("span", {
      className: "field-label-row",
      text: initialDict.editor.labelTextPositionPreset,
    });
    this.posTopBtn = createButton("btn", initialDict.editor.posTop);
    this.posCenterBtn = createButton("btn", initialDict.editor.posCenter);
    this.posBottomBtn = createButton("btn", initialDict.editor.posBottom);
    this.posTopBtn.addEventListener("click", () =>
      handlers.onChangeTextOverlay({ enabled: true, offsetY: TEXT_PRESET_OFFSETS.TOP })
    );
    this.posCenterBtn.addEventListener("click", () =>
      handlers.onChangeTextOverlay({ enabled: true, offsetY: TEXT_PRESET_OFFSETS.CENTER })
    );
    this.posBottomBtn.addEventListener("click", () =>
      handlers.onChangeTextOverlay({ enabled: true, offsetY: TEXT_PRESET_OFFSETS.BOTTOM })
    );
    const posPresetGroup = createEl("div", { className: "field-group" }, [
      this.posPresetLabelEl,
      createEl("div", { className: "preset-pill-row" }, [
        this.posTopBtn,
        this.posCenterBtn,
        this.posBottomBtn,
      ]),
    ]);

    this.fontFamilyLabel = createEl("label", {
      text: initialDict.editor.labelFontFamily,
      attrs: { for: "select-font-family" },
    });
    this.fontFamilySelect = createEl(
      "select",
      { id: "select-font-family" },
      AVAILABLE_FONT_FAMILIES.map((f) =>
        createEl("option", { text: f.label, attrs: { value: f.value } })
      )
    );
    this.fontFamilySelect.value = initialState.textOverlay.fontFamily;
    this.fontFamilySelect.addEventListener("change", () => {
      handlers.onChangeTextOverlay({ fontFamily: this.fontFamilySelect.value });
    });

    this.fontSizeCtrl = createRangeControl({
      id: "slider-font-size",
      labelText: initialDict.editor.labelFontSize,
      min: 10,
      max: 72,
      step: 1,
      initialValue: initialState.textOverlay.fontSizePx,
      formatValue: (v) => `${Math.round(v)} px`,
      onInput: (v) => handlers.onChangeTextOverlay({ fontSizePx: v }),
    });

    this.textColorLabel = createEl("label", {
      text: initialDict.editor.labelTextColor,
      attrs: { for: "color-text-fill" },
    });
    this.textColorInput = createEl("input", {
      id: "color-text-fill",
      attrs: { type: "color", value: initialState.textOverlay.textColor },
    });
    this.textColorInput.addEventListener("input", () => {
      handlers.onChangeTextOverlay({ textColor: this.textColorInput.value });
    });

    this.strokeColorLabel = createEl("label", {
      text: initialDict.editor.labelStrokeColor,
      attrs: { for: "color-stroke-fill" },
    });
    this.strokeColorInput = createEl("input", {
      id: "color-stroke-fill",
      attrs: { type: "color", value: initialState.textOverlay.strokeColor },
    });
    this.strokeColorInput.addEventListener("input", () => {
      handlers.onChangeTextOverlay({ strokeColor: this.strokeColorInput.value });
    });

    const consumerTextControlsGrid = createEl("div", { className: "slider-grid" }, [
      posPresetGroup,
      createEl("div", { className: "field-group" }, [this.fontFamilyLabel, this.fontFamilySelect]),
      this.fontSizeCtrl.root,
      createEl("div", { className: "field-group" }, [this.textColorLabel, this.textColorInput]),
      createEl("div", { className: "field-group" }, [this.strokeColorLabel, this.strokeColorInput]),
    ]);

    this.textSheetEl = createEl(
      "div",
      {
        className: "inline-text-sheet",
        attrs: { hidden: "" },
      },
      [
        enableTextRow,
        this.textTipEl,
        createEl("div", { className: "field-group" }, [
          this.overlayTextLabel,
          this.overlayTextInput,
        ]),
        consumerTextControlsGrid,
      ]
    );

    // 6. Primary Pill Upload Action + SuperBand Showcase Assembly
    const sendArea = createEl("div", { className: "send-area" }, [
      this.uploadBtn.button,
      this.progressEl,
      this.ruleReminderEl,
      this.connectHintEl,
    ]);

    const selectImageBox = createEl("div", { className: "select-image-section" }, [
      this.selectImageHeadingEl,
      pastelTilesRow,
    ]);

    this.element = createEl(
      "section",
      {
        className: "panel-card studio-stage",
        attrs: { "aria-label": initialDict.editor.heading },
      },
      [
        this.dropzoneWrapEl,
        this.cropSizeCaptionEl,
        sendArea,
        this.remainingRowEl,
        selectImageBox,
        quickToolbar,
        this.canvasHintEl,
        this.fileSummaryEl,
        this.textSheetEl,
      ]
    );

    // 7. Collapsible Precision Panels (Alignment / Rotation & JPEG Export)
    this.groupAlignHeading = createEl("h3", { text: initialDict.editor.groupAlignment });
    this.devRotateLeftBtn = createIconButton("btn", "rotateCcw", initialDict.editor.btnRotateLeft, 15);
    this.devRotateLeftBtn.button.addEventListener("click", () => handlers.onRotateStep(-90));

    this.offsetXCtrl = createRangeControl({
      id: "slider-offset-x",
      labelText: initialDict.editor.labelOffsetX,
      min: -200,
      max: 200,
      step: 1,
      initialValue: initialState.transform.offsetX,
      formatValue: (v) => `${Math.round(v)} px`,
      onInput: (v) => handlers.onChangeTransform({ offsetX: v }),
    });
    this.offsetYCtrl = createRangeControl({
      id: "slider-offset-y",
      labelText: initialDict.editor.labelOffsetY,
      min: -200,
      max: 200,
      step: 1,
      initialValue: initialState.transform.offsetY,
      formatValue: (v) => `${Math.round(v)} px`,
      onInput: (v) => handlers.onChangeTransform({ offsetY: v }),
    });
    this.scaleCtrl = createRangeControl({
      id: "slider-scale",
      labelText: initialDict.editor.labelScale,
      min: MIN_RELATIVE_SCALE,
      max: MAX_RELATIVE_SCALE,
      step: 0.02,
      initialValue: initialState.transform.scale,
      formatValue: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => handlers.onChangeTransform({ scale: v }),
    });
    this.rotationCtrl = createRangeControl({
      id: "slider-rotation",
      labelText: initialDict.editor.labelRotation,
      min: -180,
      max: 180,
      step: 1,
      initialValue: initialState.transform.rotationDeg,
      formatValue: (v) => `${Math.round(v)}°`,
      onInput: (v) => handlers.onChangeTransform({ rotationDeg: v }),
    });
    this.strokeWidthCtrl = createRangeControl({
      id: "slider-stroke-width",
      labelText: initialDict.editor.labelStrokeWidth,
      min: 0,
      max: 12,
      step: 1,
      initialValue: initialState.textOverlay.strokeWidthPx,
      formatValue: (v) => `${Math.round(v)} px`,
      onInput: (v) => handlers.onChangeTextOverlay({ strokeWidthPx: v }),
    });
    this.textOffsetYCtrl = createRangeControl({
      id: "slider-text-offset-y",
      labelText: initialDict.editor.labelTextOffsetY,
      min: -100,
      max: 100,
      step: 1,
      initialValue: initialState.textOverlay.offsetY,
      formatValue: (v) => `${Math.round(v)} px`,
      onInput: (v) => handlers.onChangeTextOverlay({ offsetY: v }),
    });

    this.fineAlignElement = createEl("div", { className: "subpanel func-subpanel" }, [
      this.groupAlignHeading,
      createEl("div", { className: "btn-row" }, [this.devRotateLeftBtn.button]),
      createEl("div", { className: "slider-grid" }, [
        this.offsetXCtrl.root,
        this.offsetYCtrl.root,
        this.scaleCtrl.root,
        this.rotationCtrl.root,
        this.strokeWidthCtrl.root,
        this.textOffsetYCtrl.root,
      ]),
    ]);

    this.groupExportHeading = createEl("h3", { text: initialDict.editor.groupExport });
    this.autoOptCheckbox = createEl("input", {
      id: "opt-auto-jpeg",
      attrs: { type: "checkbox" },
    });
    this.autoOptCheckbox.checked = initialState.encoding.autoOptimize;
    this.autoOptLabelSpan = createEl("span", { text: initialDict.editor.labelAutoOptimize });
    this.autoOptCheckbox.addEventListener("change", () => {
      handlers.onChangeEncoding({ autoOptimize: this.autoOptCheckbox.checked });
    });
    const autoOptRow = createEl(
      "label",
      { className: "check-row", attrs: { for: "opt-auto-jpeg" } },
      [this.autoOptCheckbox, this.autoOptLabelSpan]
    );

    this.manualQualityCtrl = createRangeControl({
      id: "slider-manual-quality",
      labelText: initialDict.editor.labelManualQuality,
      min: 0.1,
      max: 1.0,
      step: 0.02,
      initialValue: initialState.encoding.manualQuality,
      formatValue: (v) => v.toFixed(2),
      onInput: (v) => handlers.onChangeEncoding({ manualQuality: v }),
    });

    this.sizePill = createEl("span", { className: "pill-badge", text: "-" });
    this.inspectionPill = createEl("span", { className: "pill-badge", text: "-" });
    this.sizeWarnPill = createEl("span", {
      className: "pill-badge",
      attrs: { "data-tone": "warn", hidden: "" },
    });
    this.downloadBtn = createIconButton("btn", "download", initialDict.editor.btnDownloadJpeg, 15);
    this.downloadBtn.button.addEventListener("click", () => handlers.onDownloadJpeg());

    this.exportElement = createEl("div", { className: "subpanel func-subpanel" }, [
      this.groupExportHeading,
      autoOptRow,
      this.manualQualityCtrl.root,
      createEl("div", { className: "export-metrics" }, [
        this.sizePill,
        this.inspectionPill,
        this.sizeWarnPill,
      ]),
      createEl("div", { className: "btn-row" }, [this.downloadBtn.button]),
    ]);

    // 8. Push Screen Top Bar + Responsive Dual-Column / Collapsible Workspace (Answer A3)
    this.backBtn = createButton("btn-back-circle");
    this.backBtn.setAttribute("aria-label", initialDict.header.btnBack);
    this.backBtn.appendChild(createStudioIcon("arrowLeft", 20));
    this.backBtn.addEventListener("click", () => handlers.onBack());

    this.pushTopTitleEl = createEl("h2", {
      className: "subbar-title",
      text: initialDict.editor.pushScreenTitle,
    });
    this.deviceStatusPillEl = createEl("span", {
      className: "pill-badge push-status-pill",
      text: initialDict.editor.pushStatusOfflineBadge,
    });
    const topBarEl = createEl("div", { className: "subscreen-topbar" }, [
      this.backBtn,
      this.pushTopTitleEl,
      this.deviceStatusPillEl,
    ]);

    const isWideViewport =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(min-width: 860px)").matches;

    const buildPushAccordion = (
      iconName: "sliders" | "download",
      pastel: "violet" | "amber",
      titleText: string,
      bodyEl: HTMLElement
    ): { detailsEl: HTMLDetailsElement; titleEl: HTMLSpanElement } => {
      const iconBox = createEl(
        "span",
        { className: "pastel-tile-icon pastel-badge-icon", attrs: { "data-pastel": pastel } },
        [createStudioIcon(iconName, 18)]
      );
      const titleEl = createEl("span", { className: "func-row-title-inline", text: titleText });
      const chevronEl = createEl(
        "span",
        { className: "func-chevron", attrs: { "aria-hidden": "true" } },
        [createStudioIcon("chevronRight", 16)]
      );
      // 意図: accordion ガイドに基づき、summary 内に見出しを置かず、記号をラベル直後に添える。
      const summaryEl = createEl("summary", { className: "func-row-summary" }, [
        iconBox,
        createEl("span", { className: "func-summary-label-group" }, [titleEl, chevronEl]),
      ]);
      const detailsEl = createEl("details", { className: "func-row" }, [
        summaryEl,
        createEl("div", { className: "func-row-body" }, [bodyEl]),
      ]);
      if (isWideViewport) {
        detailsEl.open = true;
      }
      return { detailsEl, titleEl };
    };

    const alignAccordion = buildPushAccordion(
      "sliders",
      "violet",
      initialDict.editor.funcFineEditTitle,
      this.fineAlignElement
    );
    const exportAccordion = buildPushAccordion(
      "download",
      "amber",
      initialDict.editor.funcExportTitle,
      this.exportElement
    );
    this.alignSummaryTitleEl = alignAccordion.titleEl;
    this.exportSummaryTitleEl = exportAccordion.titleEl;

    const toolsColEl = createEl("div", { className: "push-tools-col" }, [
      alignAccordion.detailsEl,
      exportAccordion.detailsEl,
    ]);
    const pushWorkspaceEl = createEl("div", { className: "push-workspace" }, [
      this.element,
      toolsColEl,
    ]);
    this.screenElement = createEl(
      "div",
      {
        className: "push-screen-stack",
        attrs: { "aria-label": initialDict.editor.pushScreenTitle },
      },
      [topBarEl, pushWorkspaceEl]
    );
  }

  /**
   * Updates visible UI text after switching language and re-renders telemetry pills.
   *
   * @param nextDict - Newly activated translation dictionary.
   * @param state - Latest store snapshot.
   */
  public updateLocale(nextDict: TranslationSchema, state: AppStateSnapshot): void {
    this.dict = nextDict;
    const e = nextDict.editor;
    this.screenElement.setAttribute("aria-label", e.pushScreenTitle);
    this.backBtn.setAttribute("aria-label", nextDict.header.btnBack);
    this.pushTopTitleEl.textContent = e.pushScreenTitle;
    this.ruleReminderEl.textContent = e.pushRuleReminder;
    this.alignSummaryTitleEl.textContent = e.funcFineEditTitle;
    this.exportSummaryTitleEl.textContent = e.funcExportTitle;
    this.element.setAttribute("aria-label", e.heading);
    this.dropzoneWrapEl.setAttribute("aria-label", e.dropzonePrompt);
    this.previewCanvas.setAttribute("aria-label", e.previewCanvasAriaLabel);
    this.emptyCanvasTapBtn.labelEl.textContent = e.emptyCanvasTapLabel;
    this.canvasHintEl.textContent = e.canvasInteractionHint;

    this.selectImageHeadingEl.textContent = e.sectionSelectImage;
    this.quickCameraLabelEl.textContent = e.btnTakePhoto;
    this.quickPickLabelEl.textContent = e.btnSelectFile;
    this.refreshStorageBtn.textContent = e.btnRefreshShort;
    this.quickCoverBtn.labelEl.textContent = e.quickBtnCover;
    this.quickContainBtn.labelEl.textContent = e.quickBtnContain;
    this.quickRotateBtn.labelEl.textContent = e.quickBtnRotate;
    this.quickTextToggleBtn.labelEl.textContent = e.quickBtnText;
    this.quickBgChipText.textContent = e.labelBgColor;
    this.quickResetBtn.labelEl.textContent = e.quickBtnReset;

    this.enableTextLabelSpan.textContent = e.labelEnableText;
    this.textTipEl.textContent = e.textMotivationTip;
    this.overlayTextLabel.textContent = e.labelOverlayText;
    this.posPresetLabelEl.textContent = e.labelTextPositionPreset;
    this.posTopBtn.textContent = e.posTop;
    this.posCenterBtn.textContent = e.posCenter;
    this.posBottomBtn.textContent = e.posBottom;
    this.fontFamilyLabel.textContent = e.labelFontFamily;
    this.fontSizeCtrl.labelEl.textContent = e.labelFontSize;
    this.textColorLabel.textContent = e.labelTextColor;
    this.strokeColorLabel.textContent = e.labelStrokeColor;
    this.connectHintEl.textContent = e.connectFirstHint;

    this.groupAlignHeading.textContent = e.groupAlignment;
    this.devRotateLeftBtn.labelEl.textContent = e.btnRotateLeft;
    this.offsetXCtrl.labelEl.textContent = e.labelOffsetX;
    this.offsetYCtrl.labelEl.textContent = e.labelOffsetY;
    this.scaleCtrl.labelEl.textContent = e.labelScale;
    this.rotationCtrl.labelEl.textContent = e.labelRotation;
    this.strokeWidthCtrl.labelEl.textContent = e.labelStrokeWidth;
    this.textOffsetYCtrl.labelEl.textContent = e.labelTextOffsetY;

    this.groupExportHeading.textContent = e.groupExport;
    this.autoOptLabelSpan.textContent = e.labelAutoOptimize;
    this.manualQualityCtrl.labelEl.textContent = e.labelManualQuality;
    this.downloadBtn.labelEl.textContent = e.btnDownloadJpeg;

    this.render(state);
  }

  /**
   * Synchronizes SuperBand preview state, crop-size/storage summary, send button, and fine controls.
   *
   * @param state - Current immutable application snapshot.
   */
  public render(state: AppStateSnapshot): void {
    const e = this.dict.editor;
    this.latestTransform = state.transform;

    // Show tap-to-pick overlay & pastel empty ring look only while completely empty
    const isEmpty = !state.sourceMeta && !state.textOverlay.enabled;
    this.emptyCanvasTapBtn.button.hidden = !isEmpty;
    this.bezelRingEl.setAttribute("data-empty", String(isEmpty));
    this.fileSummaryEl.textContent = state.sourceMeta
      ? interpolate(e.fileLoadedSummary, {
          name: state.sourceMeta.fileName,
          width: state.sourceMeta.naturalWidth,
          height: state.sourceMeta.naturalHeight,
        })
      : e.noImageLoaded;

    this.quickBgColorInput.value = state.transform.backgroundColor;
    this.syncTextButtonPressed(this.textSheetOpen || state.textOverlay.enabled);

    this.offsetXCtrl.inputEl.value = String(state.transform.offsetX);
    this.offsetXCtrl.valueEl.textContent = `${Math.round(state.transform.offsetX)} px`;
    this.offsetYCtrl.inputEl.value = String(state.transform.offsetY);
    this.offsetYCtrl.valueEl.textContent = `${Math.round(state.transform.offsetY)} px`;
    this.scaleCtrl.inputEl.value = String(state.transform.scale);
    this.scaleCtrl.valueEl.textContent = `${Math.round(state.transform.scale * 100)}%`;
    this.rotationCtrl.inputEl.value = String(state.transform.rotationDeg);
    this.rotationCtrl.valueEl.textContent = `${Math.round(state.transform.rotationDeg)}°`;

    this.enableTextCheckbox.checked = state.textOverlay.enabled;
    if (this.overlayTextInput.value !== state.textOverlay.text) {
      this.overlayTextInput.value = state.textOverlay.text;
    }
    this.fontFamilySelect.value = state.textOverlay.fontFamily;
    this.fontSizeCtrl.inputEl.value = String(state.textOverlay.fontSizePx);
    this.fontSizeCtrl.valueEl.textContent = `${Math.round(state.textOverlay.fontSizePx)} px`;
    this.strokeWidthCtrl.inputEl.value = String(state.textOverlay.strokeWidthPx);
    this.strokeWidthCtrl.valueEl.textContent = `${Math.round(state.textOverlay.strokeWidthPx)} px`;
    this.textOffsetYCtrl.inputEl.value = String(state.textOverlay.offsetY);
    this.textOffsetYCtrl.valueEl.textContent = `${Math.round(state.textOverlay.offsetY)} px`;
    this.textColorInput.value = state.textOverlay.textColor;
    this.strokeColorInput.value = state.textOverlay.strokeColor;

    this.autoOptCheckbox.checked = state.encoding.autoOptimize;
    this.manualQualityCtrl.inputEl.disabled = state.encoding.autoOptimize;
    this.manualQualityCtrl.inputEl.value = String(state.encoding.manualQuality);
    this.manualQualityCtrl.valueEl.textContent = state.encoding.manualQuality.toFixed(2);

    const out = state.latestOutput;
    const meta = state.metadata;
    const dial = meta?.dialInfo;
    const expectedW = dial?.width;
    const expectedH = dial?.height;
    this.bezelRingEl.setAttribute("data-shape", dial?.shape === "square" ? "square" : "round");
    let uploadable = false;

    this.cropSizeCaptionEl.textContent = interpolate(e.cropSizeSummary, {
      kb: out ? (out.byteLength / 1024).toFixed(1) : "0.0",
    });
    if (out?.exceedsTarget) {
      this.cropSizeCaptionEl.setAttribute("data-tone", "warn");
    } else {
      this.cropSizeCaptionEl.removeAttribute("data-tone");
    }

    if (!out) {
      this.sizePill.textContent = "-";
      this.inspectionPill.textContent = "-";
      this.inspectionPill.removeAttribute("data-tone");
      this.sizeWarnPill.hidden = true;
    } else {
      this.sizePill.textContent = interpolate(e.outputSizeSummary, {
        bytes: out.byteLength.toLocaleString(),
        quality: out.usedQuality.toFixed(2),
      });

      if (out.exceedsTarget) {
        this.sizeWarnPill.textContent = interpolate(e.warnExceedsTarget, {
          bytes: out.byteLength.toLocaleString(),
        });
        this.sizeWarnPill.hidden = false;
      } else {
        this.sizeWarnPill.hidden = true;
      }

      const insp = out.inspection;
      if (insp.errorCode === "progressive_sof2") {
        this.inspectionPill.textContent = e.errorProgressiveSof2;
        this.inspectionPill.setAttribute("data-tone", "err");
      } else if (!insp.valid || !insp.baseline) {
        this.inspectionPill.textContent = e.errorInvalidJpeg;
        this.inspectionPill.setAttribute("data-tone", "err");
      } else if (
        expectedW !== undefined &&
        expectedH !== undefined &&
        (insp.width !== expectedW || insp.height !== expectedH)
      ) {
        this.inspectionPill.textContent = interpolate(e.errorDimensionMismatch, {
          expectedW,
          expectedH,
          actualW: insp.width ?? 0,
          actualH: insp.height ?? 0,
        });
        this.inspectionPill.setAttribute("data-tone", "err");
      } else {
        uploadable = isUploadableJpeg(insp, expectedW, expectedH);
        this.inspectionPill.textContent = interpolate(e.validationSof0Ok, {
          width: insp.width ?? 0,
          height: insp.height ?? 0,
        });
        this.inspectionPill.setAttribute("data-tone", "ok");
      }
    }

    const isUploading = state.connectionStatus === "uploading";
    const isConnecting = state.connectionStatus === "connecting";
    const isConnected = state.connectionStatus === "connected";
    const isBusy = isUploading || isConnecting;
    const isLinked = isConnected || isUploading;

    const activeProfile = state.savedDevices.find((d) => d.id === state.activeDeviceId);
    const badgeName = activeProfile?.nickname || meta?.deviceName || "BG02";
    const liveBattery = meta?.standardInfo?.batteryPercent;
    if (isLinked) {
      this.deviceStatusPillEl.textContent =
        liveBattery !== undefined
          ? interpolate(e.pushStatusConnectedBatBadge, {
              name: badgeName,
              battery: liveBattery,
            })
          : interpolate(e.pushStatusConnectedBadge, { name: badgeName });
      this.deviceStatusPillEl.setAttribute(
        "data-tone",
        liveBattery !== undefined && liveBattery < 20 ? "warn" : "ok"
      );
    } else {
      this.deviceStatusPillEl.textContent = e.pushStatusOfflineBadge;
      this.deviceStatusPillEl.removeAttribute("data-tone");
    }

    this.remainingRowEl.hidden = !isLinked;
    this.refreshStorageBtn.disabled = !isConnected || isBusy;
    const freeSpaceText =
      meta?.freeStorageBytes !== null && meta?.freeStorageBytes !== undefined
        ? `${(meta.freeStorageBytes / 1024).toFixed(1)} KB`
        : meta?.freeStorageError
          ? this.dict.connection.freeStorageTimedOut
          : this.dict.connection.valueNotRead;
    this.remainingTextEl.textContent = interpolate(e.remainingSpaceSummary, {
      space: freeSpaceText,
    });

    this.downloadBtn.button.disabled = !out || isUploading;
    // 意図: 未接続時でも有効な画像があれば送信ボタンから接続確認・自動再接続を実行できるよう、
    //       接続試行中・転送中でない限り押下を許可する。
    this.uploadBtn.button.disabled = !uploadable || isBusy;
    this.connectHintEl.hidden = isConnected || isBusy;

    if (isUploading && state.uploadProgress) {
      const percent = Math.round(state.uploadProgress.ratio * 100);
      this.uploadBtn.labelEl.textContent = interpolate(e.btnUploading, {
        percent,
        sent: state.uploadProgress.sentBytes.toLocaleString(),
        total: state.uploadProgress.totalBytes.toLocaleString(),
      });
      this.progressEl.hidden = false;
      this.progressEl.value = percent;
    } else if (isUploading) {
      this.uploadBtn.labelEl.textContent = e.btnPreparingUpload;
      this.progressEl.hidden = true;
      this.progressEl.value = 0;
    } else {
      this.uploadBtn.labelEl.textContent = isConnecting
        ? this.dict.connection.statusConnecting
        : e.btnUpload;
      this.progressEl.hidden = true;
      this.progressEl.value = 0;
    }
  }

  /**
   * Updates visual active state on the Quick Text button.
   *
   * @param pressed - `true` when sheet is open or text overlay is active.
   */
  private syncTextButtonPressed(pressed: boolean): void {
    this.quickTextToggleBtn.button.setAttribute("aria-pressed", String(pressed));
  }

  /**
   * Binds local file drag-and-drop highlighting onto {@link dropzoneWrapEl}.
   *
   * @param handlers - Image file selection callback holder.
   */
  private wireDropzone(handlers: BadgeEditorHandlers): void {
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
        handlers.onSelectImageFile(file);
      }
    });
  }

  /**
   * Captures a fresh baseline whenever the count of active pointers changes between 1 and 2,
   * ensuring smooth handoff from two-finger pinch back to one-finger panning.
   */
  private resetGestureBaselineFromPointers(): void {
    if (this.activePointers.size === 0) {
      this.gestureBaseline = null;
      return;
    }

    const pts = Array.from(this.activePointers.values());
    if (pts.length === 1) {
      this.gestureBaseline = {
        pointerCount: 1,
        startX: pts[0].clientX,
        startY: pts[0].clientY,
        startPinchDistance: 0,
        baseOffsetX: this.latestTransform.offsetX,
        baseOffsetY: this.latestTransform.offsetY,
        baseScale: this.latestTransform.scale,
      };
      return;
    }

    const [p1, p2] = pts;
    const dist = Math.max(8, Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY));
    this.gestureBaseline = {
      pointerCount: 2,
      startX: (p1.clientX + p2.clientX) / 2,
      startY: (p1.clientY + p2.clientY) / 2,
      startPinchDistance: dist,
      baseOffsetX: this.latestTransform.offsetX,
      baseOffsetY: this.latestTransform.offsetY,
      baseScale: this.latestTransform.scale,
    };
  }

  /**
   * Attaches 1-finger pan, 2-finger pinch-zoom, mouse wheel zoom, and keyboard arrow nudges
   * onto {@link previewCanvas}.
   *
   * @param handlers - Transform mutation callback holder.
   */
  private wireCanvasGestures(handlers: BadgeEditorHandlers): void {
    this.previewCanvas.addEventListener("pointerdown", (ev) => {
      this.previewCanvas.focus();
      this.previewCanvas.setPointerCapture(ev.pointerId);
      this.activePointers.set(ev.pointerId, { clientX: ev.clientX, clientY: ev.clientY });
      this.resetGestureBaselineFromPointers();
    });

    this.previewCanvas.addEventListener("pointermove", (ev) => {
      if (!this.activePointers.has(ev.pointerId) || !this.gestureBaseline) {
        return;
      }
      this.activePointers.set(ev.pointerId, { clientX: ev.clientX, clientY: ev.clientY });

      const rect = this.previewCanvas.getBoundingClientRect();
      // 意図: CSS でレスポンシブ拡大されたキャンバス表示サイズと内部 240px の比率を補正し、指の移動量と画像移動量を 1:1 に合わせる。
      const pxFactor = rect.width > 0 ? this.previewCanvas.width / rect.width : 1;

      if (this.gestureBaseline.pointerCount === 1 && this.activePointers.size === 1) {
        const pt = this.activePointers.get(ev.pointerId);
        if (!pt) {
          return;
        }
        const dx = (pt.clientX - this.gestureBaseline.startX) * pxFactor;
        const dy = (pt.clientY - this.gestureBaseline.startY) * pxFactor;
        handlers.onChangeTransform({
          offsetX: Math.max(-200, Math.min(200, Math.round(this.gestureBaseline.baseOffsetX + dx))),
          offsetY: Math.max(-200, Math.min(200, Math.round(this.gestureBaseline.baseOffsetY + dy))),
        });
        return;
      }

      if (this.gestureBaseline.pointerCount === 2 && this.activePointers.size >= 2) {
        const [p1, p2] = Array.from(this.activePointers.values());
        const dist = Math.max(8, Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY));
        const midX = (p1.clientX + p2.clientX) / 2;
        const midY = (p1.clientY + p2.clientY) / 2;

        const nextScale = Math.min(
          MAX_RELATIVE_SCALE,
          Math.max(
            MIN_RELATIVE_SCALE,
            Number(
              (this.gestureBaseline.baseScale * (dist / this.gestureBaseline.startPinchDistance)).toFixed(3)
            )
          )
        );
        const dx = (midX - this.gestureBaseline.startX) * pxFactor;
        const dy = (midY - this.gestureBaseline.startY) * pxFactor;

        handlers.onChangeTransform({
          scale: nextScale,
          offsetX: Math.max(-200, Math.min(200, Math.round(this.gestureBaseline.baseOffsetX + dx))),
          offsetY: Math.max(-200, Math.min(200, Math.round(this.gestureBaseline.baseOffsetY + dy))),
        });
      }
    });

    const endPointer = (ev: PointerEvent): void => {
      if (!this.activePointers.has(ev.pointerId)) {
        return;
      }
      this.activePointers.delete(ev.pointerId);
      if (this.previewCanvas.hasPointerCapture(ev.pointerId)) {
        this.previewCanvas.releasePointerCapture(ev.pointerId);
      }
      this.resetGestureBaselineFromPointers();
    };
    this.previewCanvas.addEventListener("pointerup", endPointer);
    this.previewCanvas.addEventListener("pointercancel", endPointer);

    this.previewCanvas.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const delta = ev.deltaY < 0 ? 0.08 : -0.08;
        const nextScale = Math.min(
          MAX_RELATIVE_SCALE,
          Math.max(MIN_RELATIVE_SCALE, Number((this.latestTransform.scale + delta).toFixed(2)))
        );
        handlers.onChangeTransform({ scale: nextScale });
      },
      { passive: false }
    );

    this.previewCanvas.addEventListener("keydown", (ev) => {
      const step = ev.shiftKey ? 12 : 4;
      const curX = this.latestTransform.offsetX;
      const curY = this.latestTransform.offsetY;
      const curScale = this.latestTransform.scale;

      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        handlers.onChangeTransform({ offsetX: Math.max(-200, curX - step) });
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        handlers.onChangeTransform({ offsetX: Math.min(200, curX + step) });
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        handlers.onChangeTransform({ offsetY: Math.max(-200, curY - step) });
      } else if (ev.key === "ArrowDown") {
        ev.preventDefault();
        handlers.onChangeTransform({ offsetY: Math.min(200, curY + step) });
      } else if (ev.key === "+" || ev.key === "=") {
        ev.preventDefault();
        handlers.onChangeTransform({
          scale: Math.min(MAX_RELATIVE_SCALE, Number((curScale + 0.1).toFixed(2))),
        });
      } else if (ev.key === "-") {
        ev.preventDefault();
        handlers.onChangeTransform({
          scale: Math.max(MIN_RELATIVE_SCALE, Number((curScale - 0.1).toFixed(2))),
        });
      }
    });
  }
}
