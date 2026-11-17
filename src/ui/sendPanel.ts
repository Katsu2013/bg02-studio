/**
 * @module ui/sendPanel
 * Screen 3 (`activeScreen === "send"`): Destination confirmation, 9 explicit
 * send/recovery states, native determinate/indeterminate `<progress>`,
 * immutable retry actions, and capacity/battery/compatibility refusal guidance.
 */

import { interpolate } from "../i18n/i18n";
import type { TranslationSchema } from "../i18n/types";
import { assessDeviceUploadSupport } from "../imaging/jpegInspector";
import type { AppStateSnapshot } from "../state/appStore";
import {
  resolveSendTargetView,
  type SendTargetViewState,
} from "../state/sendSession";
import { drawCircularThumbnailCanvas } from "./badgeStatusHelper";
import {
  createButton,
  createEl,
  createIconButton,
  replaceChildrenSafe,
  type IconButtonHandle,
} from "./domHelpers";
import { createStudioIcon, type StudioIconName } from "./icons";

/** Callbacks dispatched by Screen 3 (`"send"`) user interactions. */
export interface SendPanelHandlers {
  /** Navigates back to Screen 2 (`"editor"`). */
  readonly onBackToEditor: () => void;
  /** Navigates back to Screen 1 (`"home"`) after completion or reset. */
  readonly onDoneHome: () => void;
  /** Navigates to Screen 4 (`"badges"`) returning back to Send when done. */
  readonly onOpenMyBadges: () => void;
  /** Selects a saved badge ID as the explicit send target. */
  readonly onSelectSavedTarget: (deviceId: string) => void;
  /** Opens the Web Bluetooth device picker to select a new or replacement target badge. */
  readonly onChooseTargetViaPicker: () => void;
  /** Connects to the currently selected saved target (or executes send once connected). */
  readonly onConnectSelectedTarget: () => void;
  /** Starts WatchTheme3 upload of the confirmed draft to the connected selected badge. */
  readonly onSendNow: () => void;
  /** Re-transmits using the exact immutable `FrozenUploadSession` bytes captured earlier. */
  readonly onRetryFrozenUpload: () => void;
  /** Saves verified 240×240 Baseline JPEG locally as offline/unsupported fallback. */
  readonly onSaveJpegFallback: () => void;
}

/**
 * Mutable holder tracking which semantic action the primary button currently dispatches.
 */
export interface SendActionModeRef {
  /** Current action identifier (`send`, `retry`, `connect-selected`, `open-picker`, etc.). */
  mode: string;
}

/**
 * Renders Screen 3 (`"send"`): Target selection, 9 state machine banners, and transfer progress.
 */
export class SendPanel {
  /** Root container for Screen 3. */
  public readonly element: HTMLElement;
  /** Explicit `< 編集に戻る` button exposed for accessible focus placement. */
  public readonly backBtn: HTMLButtonElement;

  /** Active localized translation dictionary. */
  private dict: TranslationSchema;
  /** Navigation and BLE action callbacks into the coordinator. */
  private readonly handlers: SendPanelHandlers;
  /** Whether the browser environment exposes `navigator.bluetooth`. */
  private hasWebBluetoothSupport = true;
  /** Latest arguments supplied to {@link render} so UI-only toggles can re-render locally. */
  private latestRenderArgs: {
    /** Latest store snapshot rendered. */
    readonly state: AppStateSnapshot;
    /** Latest composited circular canvas rendered. */
    readonly exportCanvas: HTMLCanvasElement | null;
    /** Web Bluetooth capability flag passed on latest render. */
    readonly hasWebBluetooth: boolean;
  } | null = null;
  /** Switcher action button opening the Web Bluetooth picker inside `"変更"`. */
  private readonly switcherPickerBtn: IconButtonHandle;
  /** Switcher link button opening Screen 4 My Badges inside `"変更"`. */
  private readonly switcherManageBtn: IconButtonHandle;

  /** Label span inside the top navigation back button. */
  private readonly backBtnLabelEl: HTMLSpanElement;
  /** Top bar heading element for the send screen. */
  private readonly topTitleEl: HTMLHeadingElement;

  /** Thumbnail canvas previewing the encoded circular badge image inside the destination card. */
  private readonly thumbCanvas: HTMLCanvasElement;
  /** Toggle state controlling whether inline destination switcher controls are expanded. */
  private targetSwitcherOpen = false;

  /** Heading for the target device connection and status card. */
  private readonly targetCardHeadingEl: HTMLHeadingElement;
  /** Compact destination badge display name in the unified hero summary. */
  private readonly targetSummaryNameEl: HTMLParagraphElement;
  /** Compact destination connection pill in the unified hero summary. */
  private readonly targetSummaryPillEl: HTMLSpanElement;
  /** Understated toggle button expanding/collapsing the target switcher (`"変更"`). */
  private readonly changeTargetBtn: HTMLButtonElement;
  /** Expandable container holding saved badge radios and chooser/management actions. */
  private readonly targetSwitcherBodyEl: HTMLDivElement;
  /** Warning banner displayed if session drift or async prepare drift invalidated a ready image. */
  private readonly driftAlertEl: HTMLDivElement;
  /** Text span inside the session-drift warning banner. */
  private readonly driftAlertTextEl: HTMLSpanElement;

  /** Container listing saved target badges when choosing which badge to send to. */
  private readonly savedCandidatesWrapEl: HTMLDivElement;
  /** Heading above the selectable saved-badge buttons. */
  private readonly savedCandidatesTitleEl: HTMLSpanElement;
  /** Flex/grid list holding rendered saved-badge selector buttons. */
  private readonly savedCandidatesListEl: HTMLDivElement;

  /** Status callout banner summarizing readiness, transfer progress, or errors. */
  private readonly stateBannerEl: HTMLDivElement;
  /** Wrapper element holding the status icon SVG inside the state banner. */
  private readonly stateIconWrapEl: HTMLSpanElement;
  /** Heading inside the send status banner. */
  private readonly stateTitleEl: HTMLHeadingElement;
  /** Explanatory paragraph inside the send status banner. */
  private readonly stateBodyEl: HTMLParagraphElement;
  /** Secondary subtle metadata line inside the send status banner. */
  private readonly stateSubtleMetaEl: HTMLParagraphElement;
  /** Alert shown when a different badge is currently connected over BLE. */
  private readonly otherLinkedWarningEl: HTMLDivElement;
  /** Text span describing which other badge is currently connected. */
  private readonly otherLinkedWarningTextEl: HTMLSpanElement;

  /** Native determinate/indeterminate `<progress>` bar for image transfer. */
  private readonly progressEl: HTMLProgressElement;
  /** Container row holding live battery and storage telemetry pills. */
  private readonly telemetryRowEl: HTMLDivElement;
  /** Pill displaying live or unconfirmed battery percentage. */
  private readonly batteryPillEl: HTMLSpanElement;
  /** Pill displaying remaining free flash storage on the badge. */
  private readonly storagePillEl: HTMLSpanElement;
  /** Notice reminding users that sending replaces the badge's custom face. */
  private readonly overwriteNoticeEl: HTMLParagraphElement;

  /** Accordion showing supported browsers when Web Bluetooth is unavailable. */
  private readonly supportedEnvDetailsEl: HTMLDetailsElement;
  /** Accordion summary label for supported environments. */
  private readonly supportedEnvSummaryEl: HTMLElement;
  /** Accordion body explaining Web Bluetooth browser requirements. */
  private readonly supportedEnvBodyEl: HTMLParagraphElement;

  /** Primary CTA button triggering send, retry, or badge connection. */
  private readonly primaryActionBtn: IconButtonHandle;
  /** Secondary button opening badge switching or device detail actions. */
  private readonly secondaryActionBtn: IconButtonHandle;
  /** Tertiary action button opening device diagnostics or troubleshooting. */
  private readonly tertiaryActionBtn: IconButtonHandle;
  /** Mutable state reference read by click listeners on the primary button. */
  private readonly actionModeRef: SendActionModeRef = { mode: "none" };

  /**
   * Builds Screen 3 DOM structure and event wiring.
   *
   * @param initialDict - Active localized translation schema.
   * @param handlers - Send flow and recovery callbacks.
   */
  public constructor(initialDict: TranslationSchema, handlers: SendPanelHandlers) {
    this.dict = initialDict;
    this.handlers = handlers;

    this.backBtnLabelEl = createEl("span", { text: initialDict.send.btnBackEdit });
    this.backBtn = createEl("button", { className: "screen-back-btn" }, [
      createStudioIcon("arrowLeft", 18),
      this.backBtnLabelEl,
    ]);
    this.backBtn.type = "button";
    this.backBtn.addEventListener("click", handlers.onBackToEditor);

    this.topTitleEl = createEl("h1", {
      className: "screen-top-title",
      text: initialDict.send.screenTitle,
    });
    const topBar = createEl("div", { className: "screen-top-bar" }, [
      this.backBtn,
      this.topTitleEl,
      createEl("span", { className: "screen-top-spacer", attrs: { "aria-hidden": "true" } }),
    ]);

    // Compact Thumbnail & Target Hero Summary
    this.thumbCanvas = createEl("canvas", {
      className: "send-thumb-canvas",
      attrs: { width: "240", height: "240", "aria-hidden": "true" },
    });
    this.targetSummaryNameEl = createEl("p", { className: "send-target-name", text: "" });
    this.targetSummaryPillEl = createEl("span", { className: "mini-pill", text: "" });
    this.changeTargetBtn = createButton(
      "btn btn-sm btn-ghost send-change-target-btn",
      initialDict.send.btnChangeTarget
    );
    this.changeTargetBtn.setAttribute("aria-expanded", "false");
    this.changeTargetBtn.addEventListener("click", () => {
      this.targetSwitcherOpen = !this.targetSwitcherOpen;
      this.changeTargetBtn.setAttribute("aria-expanded", String(this.targetSwitcherOpen));
      if (this.latestRenderArgs) {
        this.render(
          this.latestRenderArgs.state,
          this.latestRenderArgs.exportCanvas,
          this.latestRenderArgs.hasWebBluetooth
        );
      }
    });

    // Target & State Machine Card
    this.targetCardHeadingEl = createEl("h2", {
      className: "card-section-title send-dest-heading",
      text: initialDict.send.targetCardHeading,
    });
    this.driftAlertTextEl = createEl("span", { text: initialDict.send.targetDriftNotice });
    this.driftAlertEl = createEl(
      "div",
      { className: "inline-alert", attrs: { role: "alert", "data-tone": "warn" } },
      [createStudioIcon("alert", 18), this.driftAlertTextEl]
    );
    this.driftAlertEl.hidden = true;

    this.savedCandidatesTitleEl = createEl("span", {
      className: "field-sub-label",
      text: initialDict.send.savedTargetsHeading,
    });
    this.savedCandidatesListEl = createEl("div", {
      className: "send-candidates-group",
      attrs: { role: "radiogroup", "aria-label": initialDict.send.savedTargetsHeading },
    });
    this.savedCandidatesWrapEl = createEl("div", { className: "send-candidates-wrap" }, [
      this.savedCandidatesTitleEl,
      this.savedCandidatesListEl,
    ]);
    this.savedCandidatesWrapEl.hidden = true;

    this.switcherPickerBtn = createIconButton(
      "btn btn-sm btn-secondary",
      "bluetooth",
      initialDict.send.btnChooseAnotherBadge,
      16
    );
    this.switcherPickerBtn.button.addEventListener("click", () => {
      this.targetSwitcherOpen = false;
      this.changeTargetBtn.setAttribute("aria-expanded", "false");
      handlers.onChooseTargetViaPicker();
    });
    this.switcherManageBtn = createIconButton(
      "btn btn-sm btn-ghost",
      "badge",
      initialDict.send.btnManageBadges,
      16
    );
    this.switcherManageBtn.button.addEventListener("click", () => {
      this.targetSwitcherOpen = false;
      this.changeTargetBtn.setAttribute("aria-expanded", "false");
      handlers.onOpenMyBadges();
    });
    const switcherAltRow = createEl("div", { className: "send-switcher-actions" }, [
      this.switcherPickerBtn.button,
      this.switcherManageBtn.button,
    ]);
    this.targetSwitcherBodyEl = createEl("div", { className: "send-switcher-panel" }, [
      this.savedCandidatesWrapEl,
      switcherAltRow,
    ]);
    this.targetSwitcherBodyEl.hidden = true;

    const sendHeroRow = createEl("div", { className: "send-hero-row" }, [
      createEl("div", { className: "send-hero-summary" }, [
        createEl("div", { className: "send-hero-kicker" }, [
          this.targetCardHeadingEl,
          this.changeTargetBtn,
        ]),
        createEl("div", { className: "send-hero-target-row" }, [
          this.targetSummaryNameEl,
          this.targetSummaryPillEl,
        ]),
      ]),
    ]);

    this.stateIconWrapEl = createEl("span", {
      className: "send-state-icon",
      attrs: { "aria-hidden": "true" },
    });
    this.stateTitleEl = createEl("h3", { className: "send-state-title", text: "" });
    this.stateBodyEl = createEl("p", { className: "send-state-body", text: "" });
    this.stateSubtleMetaEl = createEl("p", { className: "send-state-meta", text: "" });
    this.stateSubtleMetaEl.hidden = true;

    const stateHead = createEl("div", { className: "send-state-head" }, [
      this.stateIconWrapEl,
      this.stateTitleEl,
    ]);
    this.stateBannerEl = createEl("div", { className: "send-state-box" }, [
      stateHead,
      this.stateBodyEl,
      this.stateSubtleMetaEl,
    ]);

    this.otherLinkedWarningTextEl = createEl("span", { text: "" });
    this.otherLinkedWarningEl = createEl(
      "div",
      { className: "inline-alert", attrs: { role: "status", "data-tone": "info" } },
      [createStudioIcon("info", 18), this.otherLinkedWarningTextEl]
    );
    this.otherLinkedWarningEl.hidden = true;

    this.progressEl = createEl("progress", {
      className: "send-native-progress",
      attrs: { max: "100", value: "0" },
    });
    this.progressEl.hidden = true;

    this.batteryPillEl = createEl("span", { className: "telemetry-pill", text: "" });
    this.storagePillEl = createEl("span", { className: "telemetry-pill", text: "" });
    this.telemetryRowEl = createEl("div", { className: "send-telemetry-row" }, [
      this.batteryPillEl,
      this.storagePillEl,
    ]);
    this.telemetryRowEl.hidden = true;

    this.overwriteNoticeEl = createEl("p", {
      className: "send-overwrite-note",
      text: initialDict.send.replaceCustomSlotNote,
    });
    this.overwriteNoticeEl.hidden = true;

    this.supportedEnvSummaryEl = createEl("summary", {}, [
      createEl("span", { text: initialDict.send.viewSupportedEnvSummary }),
    ]);
    this.supportedEnvBodyEl = createEl("p", {
      className: "details-copy",
      text: initialDict.send.supportedEnvBody,
    });
    this.supportedEnvDetailsEl = createEl("details", { className: "editor-details" }, [
      this.supportedEnvSummaryEl,
      createEl("div", { className: "details-body" }, [this.supportedEnvBodyEl]),
    ]);
    this.supportedEnvDetailsEl.hidden = true;

    this.primaryActionBtn = createIconButton("btn btn-primary btn-cta-large", "send", "", 18);
    this.secondaryActionBtn = createIconButton("btn btn-secondary", "bluetooth", "", 18);
    this.tertiaryActionBtn = createIconButton("btn btn-ghost", "badge", "", 18);

    this.primaryActionBtn.button.addEventListener("click", () => {
      switch (this.actionModeRef.mode) {
        case "choose_target":
        case "open_picker":
          this.handlers.onChooseTargetViaPicker();
          break;
        case "connect_target":
          this.handlers.onConnectSelectedTarget();
          break;
        case "send_now":
          this.handlers.onSendNow();
          break;
        case "retry_frozen":
          this.handlers.onRetryFrozenUpload();
          break;
        case "done_home":
          this.handlers.onDoneHome();
          break;
        case "save_fallback":
          this.handlers.onSaveJpegFallback();
          break;
      }
    });

    this.secondaryActionBtn.button.addEventListener("click", () => {
      switch (this.secondaryActionBtn.button.dataset.sendAlt) {
        case "badges":
          this.handlers.onOpenMyBadges();
          break;
        case "save":
          this.handlers.onSaveJpegFallback();
          break;
        case "edit":
          this.handlers.onBackToEditor();
          break;
        case "picker":
        default:
          this.handlers.onChooseTargetViaPicker();
          break;
      }
    });

    this.tertiaryActionBtn.button.addEventListener("click", handlers.onOpenMyBadges);

    const actionsStack = createEl("div", { className: "send-actions-stack" }, [
      this.primaryActionBtn.button,
      this.secondaryActionBtn.button,
      this.tertiaryActionBtn.button,
    ]);

    const targetCard = createEl("section", { className: "surface-card send-target-card" }, [
      sendHeroRow,
      this.targetSwitcherBodyEl,
      this.driftAlertEl,
      this.stateBannerEl,
      this.progressEl,
      this.otherLinkedWarningEl,
      this.telemetryRowEl,
      this.supportedEnvDetailsEl,
      this.overwriteNoticeEl,
      actionsStack,
    ]);

    this.element = createEl(
      "section",
      {
        id: "screen-send",
        className: "screen-view send-screen",
        attrs: { "aria-label": initialDict.send.screenTitle },
      },
      [
        topBar,
        createEl("div", { className: "send-composition" }, [
          createEl("div", { className: "send-preview-stage" }, [this.thumbCanvas]),
          targetCard,
        ]),
      ]
    );
  }

  /**
   * Synchronizes localized strings across Screen 3 controls and re-renders.
   *
   * @param nextDict - Updated translation schema.
   * @param state - Latest store snapshot.
   * @param exportCanvas - Current 240×240 export canvas.
   * @param webBluetoothAvailable - Whether `navigator.bluetooth` is supported in this browser.
   */
  public updateLocale(
    nextDict: TranslationSchema,
    state: AppStateSnapshot,
    exportCanvas: HTMLCanvasElement | null,
    webBluetoothAvailable: boolean
  ): void {
    this.dict = nextDict;
    const s = nextDict.send;
    this.element.setAttribute("aria-label", s.screenTitle);
    this.backBtnLabelEl.textContent = s.btnBackEdit;
    this.topTitleEl.textContent = s.screenTitle;
    this.targetCardHeadingEl.textContent = s.targetCardHeading;
    this.changeTargetBtn.textContent = s.btnChangeTarget;
    this.switcherPickerBtn.labelEl.textContent = s.btnChooseAnotherBadge;
    this.switcherManageBtn.labelEl.textContent = s.btnManageBadges;
    this.savedCandidatesTitleEl.textContent = s.savedTargetsHeading;
    this.savedCandidatesListEl.setAttribute("aria-label", s.savedTargetsHeading);
    this.supportedEnvSummaryEl.firstElementChild!.textContent = s.viewSupportedEnvSummary;
    this.supportedEnvBodyEl.textContent = s.supportedEnvBody;
    this.overwriteNoticeEl.textContent = s.replaceCustomSlotNote;
    this.render(state, exportCanvas, webBluetoothAvailable);
  }

  /**
   * Updates Send Screen summary, switcher, prepare/transfer/recovery states,
   * native `<progress>`, refusal-only telemetry, and primary/recovery CTAs.
   *
   * @param state - Latest store snapshot.
   * @param exportCanvas - Current 240×240 export canvas.
   * @param webBluetoothAvailable - Whether Web Bluetooth is exposed by the runtime browser.
   */
  public render(
    state: AppStateSnapshot,
    exportCanvas: HTMLCanvasElement | null,
    webBluetoothAvailable: boolean
  ): void {
    this.latestRenderArgs = { state, exportCanvas, hasWebBluetooth: webBluetoothAvailable };
    this.hasWebBluetoothSupport = webBluetoothAvailable;
    const s = this.dict.send;

    drawCircularThumbnailCanvas(this.thumbCanvas, exportCanvas);

    if (state.sendOutcome?.kind === "prepare_aborted") {
      this.driftAlertEl.hidden = false;
      this.driftAlertTextEl.textContent = `${s.statePrepareAbortedTitle}: ${s.statePrepareAbortedBody}`;
    } else if (state.targetDriftNotice) {
      this.driftAlertEl.hidden = false;
      this.driftAlertTextEl.textContent = s.targetDriftNotice;
    } else {
      this.driftAlertEl.hidden = true;
    }

    const targetView = resolveSendTargetView({
      selectedSendTargetId: state.selectedSendTargetId,
      savedDevices: state.savedDevices,
      clientConnected: state.connectionStatus === "connected",
      clientActiveId: state.activeDeviceId,
      connectedMetadata: state.metadata,
    });

    if (targetView.targetDeviceId && targetView.targetDisplayName) {
      this.targetSummaryNameEl.textContent = targetView.targetDisplayName;
      this.targetSummaryPillEl.hidden = false;
      if (targetView.isTargetConnected) {
        this.targetSummaryPillEl.textContent = this.dict.badges.statusConnected;
        this.targetSummaryPillEl.setAttribute("data-tone", "ok");
      } else if (
        state.reconnectStatus !== null &&
        state.reconnectStatus.targetDeviceId === targetView.targetDeviceId
      ) {
        this.targetSummaryPillEl.textContent = interpolate(this.dict.badges.statusReconnecting, {
          attempt: state.reconnectStatus.attempt,
          max: state.reconnectStatus.maxAttempts,
        });
        this.targetSummaryPillEl.setAttribute("data-tone", "info");
      } else {
        this.targetSummaryPillEl.textContent = this.dict.badges.statusDisconnected;
        this.targetSummaryPillEl.removeAttribute("data-tone");
      }
    } else {
      this.targetSummaryNameEl.textContent = s.unselectedTargetLabel;
      this.targetSummaryPillEl.hidden = true;
    }

    const isInFlightBle =
      state.uploadProgress !== null || state.connectionStatus === "connecting";
    const isCompleted = state.sendOutcome?.kind === "completed";
    const lockSwitching = isInFlightBle || isCompleted || !webBluetoothAvailable;

    if (lockSwitching && this.targetSwitcherOpen) {
      this.targetSwitcherOpen = false;
      this.changeTargetBtn.setAttribute("aria-expanded", "false");
    }

    const showChangeToggle = !lockSwitching && targetView.targetDeviceId !== null;
    this.changeTargetBtn.hidden = !showChangeToggle;
    this.changeTargetBtn.disabled = lockSwitching;

    const showSwitcherPanel =
      !lockSwitching &&
      (this.targetSwitcherOpen ||
        (targetView.targetDeviceId === null && state.savedDevices.length > 0));
    this.targetSwitcherBodyEl.hidden = !showSwitcherPanel;

    this.renderSavedCandidates(
      state,
      targetView,
      isInFlightBle || !webBluetoothAvailable
    );

    // Reset shared dynamic visibility prior to applying exact state branch
    this.stateBannerEl.hidden = false;
    this.progressEl.hidden = true;
    this.otherLinkedWarningEl.hidden = true;
    this.telemetryRowEl.hidden = true;
    this.supportedEnvDetailsEl.hidden = true;
    this.overwriteNoticeEl.hidden = true;
    this.stateSubtleMetaEl.hidden = true;
    this.secondaryActionBtn.button.hidden = false;
    this.tertiaryActionBtn.button.hidden = false;
    this.primaryActionBtn.button.disabled = false;
    this.secondaryActionBtn.button.disabled = false;
    this.tertiaryActionBtn.button.disabled = false;
    this.backBtn.disabled = Boolean(state.uploadProgress);

    // State 1: Environment does not support Web Bluetooth
    if (!this.hasWebBluetoothSupport) {
      this.setStateVisual("alert", "warn", s.unsupportedEnvTitle, "");
      this.supportedEnvDetailsEl.hidden = false;
      this.actionModeRef.mode = "save_fallback";
      this.configureButton(this.primaryActionBtn, "download", s.btnSaveJpegFallback);
      this.configureButton(this.secondaryActionBtn, "badge", s.btnManageBadges);
      this.secondaryActionBtn.button.dataset.sendAlt = "badges";
      this.tertiaryActionBtn.button.hidden = true;
      return;
    }

    // State 2a: Preparing JPEG output before starting BLE writes
    if (state.preparingSend !== null && state.uploadProgress === null) {
      this.setStateVisual("refresh", "info", s.statePreparingTitle, "");
      this.progressEl.hidden = false;
      this.progressEl.removeAttribute("value");
      this.overwriteNoticeEl.hidden = false;
      this.actionModeRef.mode = "preparing";
      this.configureButton(this.primaryActionBtn, "refresh", s.btnPreparingSend);
      this.primaryActionBtn.button.disabled = true;
      this.secondaryActionBtn.button.hidden = true;
      this.tertiaryActionBtn.button.hidden = true;
      return;
    }

    // State 2 & 3: Sending chunks OR awaiting final 0x20/0x04 / 0x05 completion response
    if (state.uploadProgress) {
      const targetLabel = targetView.targetDisplayName ?? "BG02";
      const pct = Math.min(100, Math.max(0, Math.round(state.uploadProgress.ratio * 100)));
      this.progressEl.hidden = false;

      if (state.uploadProgress.stage === "awaiting_finish") {
        this.setStateVisual(
          "info",
          "info",
          s.stateAwaitingFinishTitle,
          interpolate(s.stateSendingDetail, {
            sent: state.uploadProgress.sentBytes.toLocaleString(),
            total: state.uploadProgress.totalBytes.toLocaleString(),
            current: state.uploadProgress.currentChunk,
            chunks: state.uploadProgress.totalChunks,
          })
        );
        this.progressEl.removeAttribute("value");
      } else {
        const sub = interpolate(s.stateSendingDetail, {
          sent: state.uploadProgress.sentBytes.toLocaleString(),
          total: state.uploadProgress.totalBytes.toLocaleString(),
          current: state.uploadProgress.currentChunk,
          chunks: state.uploadProgress.totalChunks,
        });
        this.setStateVisual(
          "send",
          "info",
          interpolate(s.stateSendingProgress, { name: targetLabel, percent: pct }),
          sub
        );
        this.progressEl.setAttribute("value", String(pct));
      }

      if (state.reconnectStatus !== null) {
        this.stateSubtleMetaEl.hidden = false;
        this.stateSubtleMetaEl.textContent = interpolate(s.stateRetryingNotice, {
          attempt: state.reconnectStatus.attempt,
          max: state.reconnectStatus.maxAttempts,
        });
      }

      this.overwriteNoticeEl.hidden = false;
      this.actionModeRef.mode = "sending";
      this.configureButton(this.primaryActionBtn, "send", `${pct}%`);
      this.primaryActionBtn.button.disabled = true;
      this.secondaryActionBtn.button.hidden = true;
      this.tertiaryActionBtn.button.hidden = true;
      return;
    }

    // State 4: Connecting / Picker open / Auto-reconnect in progress
    if (state.connectionStatus === "connecting" || state.reconnectStatus !== null) {
      const reconnectDevName = state.reconnectStatus
        ? state.savedDevices.find((d) => d.id === state.reconnectStatus?.targetDeviceId)?.nickname
        : undefined;
      const pendingName =
        reconnectDevName ??
        targetView.targetDisplayName ??
        state.savedDevices.find((d) => d.id === state.pendingConnectDeviceId)?.nickname ??
        "BG02";
      const headline = state.reconnectStatus
        ? interpolate(s.stateReconnectingTitle, { name: pendingName })
        : interpolate(s.stateConnectingTitle, { name: pendingName });
      this.setStateVisual(
        "bluetooth",
        "info",
        headline,
        state.reconnectStatus !== null
          ? interpolate(s.stateRetryingNotice, {
              attempt: state.reconnectStatus.attempt,
              max: state.reconnectStatus.maxAttempts,
            })
          : s.cancelPickerNote
      );
      this.progressEl.hidden = false;
      this.progressEl.removeAttribute("value");
      this.actionModeRef.mode = "connecting";
      this.configureButton(this.primaryActionBtn, "bluetooth", headline);
      this.primaryActionBtn.button.disabled = true;
      this.secondaryActionBtn.button.hidden = true;
      this.tertiaryActionBtn.button.hidden = true;
      return;
    }

    // State 5: Transfer completed cleanly (only after Finish ACK!)
    if (state.sendOutcome?.kind === "completed") {
      const o = state.sendOutcome;
      this.setStateVisual(
        "check",
        "ok",
        interpolate(s.stateCompletedTitle, { name: o.targetDeviceName }),
        s.stateCompletedHint
      );
      this.actionModeRef.mode = "done_home";
      this.configureButton(this.primaryActionBtn, "check", s.btnDoneHome);
      this.secondaryActionBtn.button.hidden = true;
      this.tertiaryActionBtn.button.hidden = true;
      return;
    }

    // State 5b: Explicit user connection failed (surface recovery directly above CTA)
    if (state.sendOutcome?.kind === "connect_failed") {
      const o = state.sendOutcome;
      const headline = interpolate(s.stateConnectFailedTitle, {
        name: o.targetDeviceName || targetView.targetDisplayName || "BG02",
      });
      if (o.connectFailureReason === "permission_unavailable") {
        this.setStateVisual("alert", "err", headline, s.connectPermissionUnavailableBody);
        this.actionModeRef.mode = "open_picker";
        this.configureButton(this.primaryActionBtn, "bluetooth", s.btnReselectBluetooth);
        this.secondaryActionBtn.button.hidden = true;
        this.tertiaryActionBtn.button.hidden = true;
      } else {
        this.setStateVisual("alert", "err", headline, s.connectGattFailedBody);
        this.actionModeRef.mode = "connect_target";
        this.configureButton(this.primaryActionBtn, "bluetooth", s.btnRetryPowerRange);
        this.configureButton(this.secondaryActionBtn, "bluetooth", s.btnReselectBluetooth);
        this.secondaryActionBtn.button.dataset.sendAlt = "picker";
        this.tertiaryActionBtn.button.hidden = true;
      }
      return;
    }

    // State 6: Device refusal (storage full, low battery <20%, charging code=4) — outcome or live preflight
    if (state.sendOutcome?.kind === "device_refusal") {
      const o = state.sendOutcome;
      let headline = o.message;
      let advice = s.refusalPowerAdvice;
      if (o.errorKey === "storageFull") {
        headline = s.refusalStorageTitle;
        advice = s.refusalStorageAdvice;
      } else if (o.errorKey === "lowBattery") {
        headline = s.refusalBatteryTitle;
        advice = s.refusalPowerAdvice;
      } else if (o.errorKey === "deviceCharging") {
        headline = s.refusalChargingTitle;
        advice = s.refusalPowerAdvice;
      }
      this.setStateVisual("alert", "warn", headline, advice);
      this.renderTelemetryRow(targetView);
      this.actionModeRef.mode = "retry_frozen";
      this.configureButton(
        this.primaryActionBtn,
        "refresh",
        targetView.isTargetConnected ? s.btnRetrySameImage : s.btnReconnectAndRetry
      );
      this.configureButton(this.secondaryActionBtn, "download", s.btnSaveJpegFallback);
      this.secondaryActionBtn.button.dataset.sendAlt = "save";
      this.configureButton(this.tertiaryActionBtn, "badge", s.btnManageBadges);
      return;
    }
    this.secondaryActionBtn.button.dataset.sendAlt = "picker";

    // State 7: Disconnect or post-95% Finish timeout
    if (state.sendOutcome?.kind === "disconnect_or_timeout") {
      const o = state.sendOutcome;
      const headline = o.isFinishTimeout
        ? s.stateTimeoutTitle
        : interpolate(s.stateLinkDroppedTitle, { name: o.targetDeviceName });
      this.setStateVisual("alert", "err", headline, s.stateTimeoutHint);
      this.actionModeRef.mode = "retry_frozen";
      this.configureButton(
        this.primaryActionBtn,
        "refresh",
        targetView.isTargetConnected ? s.btnRetrySameImage : s.btnReconnectAndRetry
      );
      this.configureButton(this.secondaryActionBtn, "bluetooth", s.btnChooseAnotherBadge);
      this.configureButton(this.tertiaryActionBtn, "badge", s.btnManageBadges);
      return;
    }

    // State 8: Connected target firmware / algorithm / verification unsupported
    if (state.sendOutcome?.kind === "unsupported") {
      const reasonText =
        state.sendOutcome.unsupportedReason === "unsupported_algorithm"
          ? interpolate(s.unsupportedAlgorithmReason, {
              algo: state.sendOutcome.algorithm ?? "-",
            })
          : s.unsupportedUnverifiedReason;
      this.setStateVisual("alert", "warn", s.unsupportedDeviceTitle, reasonText);
      this.supportedEnvDetailsEl.hidden = false;
      this.actionModeRef.mode = "save_fallback";
      this.configureButton(this.primaryActionBtn, "download", s.btnSaveJpegFallback);
      this.configureButton(this.secondaryActionBtn, "bluetooth", s.btnChooseAnotherBadge);
      this.tertiaryActionBtn.button.hidden = true;
      return;
    }

    if (targetView.isTargetConnected && targetView.liveMetadata) {
      const support = assessDeviceUploadSupport(targetView.liveMetadata);
      if (!support.supported) {
        const reasonText =
          support.reason === "unsupported_algorithm"
            ? interpolate(s.unsupportedAlgorithmReason, { algo: support.algorithm ?? "-" })
            : s.unsupportedUnverifiedReason;
        this.setStateVisual("alert", "warn", s.unsupportedDeviceTitle, reasonText);
        this.supportedEnvDetailsEl.hidden = false;
        this.actionModeRef.mode = "save_fallback";
        this.configureButton(this.primaryActionBtn, "download", s.btnSaveJpegFallback);
        this.configureButton(this.secondaryActionBtn, "bluetooth", s.btnChooseAnotherBadge);
        this.tertiaryActionBtn.button.hidden = true;
        return;
      }

      // Live connected pre-flight checks (low battery < 20% or free storage < payload bytes)
      const liveBattery = targetView.liveMetadata.standardInfo?.batteryPercent;
      const liveFree = targetView.liveMetadata.freeStorageBytes;
      const outBytes = state.latestOutput?.byteLength ?? 0;
      if (liveBattery !== undefined && liveBattery < 20) {
        this.setStateVisual("alert", "warn", s.refusalBatteryTitle, s.refusalPowerAdvice);
        this.renderTelemetryRow(targetView);
        this.actionModeRef.mode = "save_fallback";
        this.configureButton(this.primaryActionBtn, "download", s.btnSaveJpegFallback);
        this.configureButton(this.secondaryActionBtn, "badge", s.btnManageBadges);
        this.secondaryActionBtn.button.dataset.sendAlt = "badges";
        this.tertiaryActionBtn.button.hidden = true;
        return;
      }
      if (liveFree !== null && outBytes > 0 && liveFree < outBytes) {
        this.setStateVisual("alert", "warn", s.refusalStorageTitle, s.refusalStorageAdvice);
        this.renderTelemetryRow(targetView);
        this.actionModeRef.mode = "save_fallback";
        this.configureButton(this.primaryActionBtn, "download", s.btnSaveJpegFallback);
        this.configureButton(this.secondaryActionBtn, "badge", s.btnManageBadges);
        this.secondaryActionBtn.button.dataset.sendAlt = "badges";
        this.tertiaryActionBtn.button.hidden = true;
        return;
      }

      // State 9a: Ready to send!
      const targetName = targetView.targetDisplayName ?? "BG02";
      this.stateBannerEl.hidden = true;
      this.overwriteNoticeEl.hidden = false;
      this.actionModeRef.mode = "send_now";
      this.configureButton(
        this.primaryActionBtn,
        "send",
        interpolate(s.btnSendTarget, { name: targetName })
      );
      this.secondaryActionBtn.button.hidden = true;
      this.tertiaryActionBtn.button.hidden = true;
      return;
    }

    // State 9b: Target chosen explicitly, currently disconnected (never leaks other badge info!)
    if (targetView.targetDeviceId && targetView.targetDisplayName) {
      this.stateBannerEl.hidden = true;

      if (targetView.isDifferentDeviceConnected && state.metadata?.deviceId) {
        const otherProfile = state.savedDevices.find(
          (d) => d.id === state.metadata?.deviceId
        );
        const otherName = otherProfile?.nickname ?? state.metadata.deviceName ?? "BG02";
        this.otherLinkedWarningEl.hidden = false;
        this.otherLinkedWarningTextEl.textContent = interpolate(s.otherBadgeLinkedNote, {
          other: otherName,
          target: targetView.targetDisplayName,
        });
      }

      this.actionModeRef.mode = "connect_target";
      this.configureButton(
        this.primaryActionBtn,
        "bluetooth",
        interpolate(s.btnConnectTarget, { name: targetView.targetDisplayName })
      );
      this.secondaryActionBtn.button.hidden = true;
      this.tertiaryActionBtn.button.hidden = true;
      return;
    }

    // State 9c: No target selected yet (`送り先未選択`)
    if (state.savedDevices.length === 0) {
      this.setStateVisual("bluetooth", "info", s.stateUnselectedTitle, s.firstConnectStepHint);
    } else {
      this.stateBannerEl.hidden = true;
    }
    this.actionModeRef.mode = "choose_target";
    this.configureButton(this.primaryActionBtn, "bluetooth", s.btnChooseTarget);
    this.configureButton(this.secondaryActionBtn, "badge", s.btnManageBadges);
    this.secondaryActionBtn.button.dataset.sendAlt = "badges";
    this.tertiaryActionBtn.button.hidden = true;
  }

  /**
   * Renders the radio group of saved badges so the user can pick the upload target.
   *
   * @param state - Current application state snapshot.
   * @param targetView - Resolved send-target status without leaking sibling telemetry.
   * @param locked - Whether active BLE transfer locks target switching.
   */
  private renderSavedCandidates(
    state: AppStateSnapshot,
    targetView: SendTargetViewState,
    locked: boolean
  ): void {
    if (state.savedDevices.length === 0) {
      this.savedCandidatesWrapEl.hidden = true;
      replaceChildrenSafe(this.savedCandidatesListEl, []);
      return;
    }
    this.savedCandidatesWrapEl.hidden = false;
    const nodes: HTMLElement[] = [];
    for (const dev of state.savedDevices) {
      const radioId = `send-candidate-${dev.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      const input = createEl("input", {
        id: radioId,
        className: "send-candidate-radio",
        attrs: { type: "radio", name: "bg02-send-target", value: dev.id },
      });
      input.checked = targetView.targetDeviceId === dev.id;
      input.disabled = locked;
      input.addEventListener("change", () => {
        if (input.checked) {
          this.targetSwitcherOpen = false;
          this.changeTargetBtn.setAttribute("aria-expanded", "false");
          this.handlers.onSelectSavedTarget(dev.id);
        }
      });

      const isThisLive =
        state.connectionStatus === "connected" && state.activeDeviceId === dev.id;
      const isLastUsed = state.reconnectPrefs.lastActiveDeviceId === dev.id;

      const labelText = createEl("span", { className: "send-candidate-name", text: dev.nickname });
      const badgeNodes: HTMLElement[] = [labelText];
      if (isThisLive) {
        badgeNodes.push(
          createEl("span", {
            className: "mini-pill",
            text: this.dict.badges.statusConnected,
            attrs: { "data-tone": "ok" },
          })
        );
      } else if (isLastUsed && !targetView.targetDeviceId) {
        badgeNodes.push(
          createEl("span", {
            className: "mini-pill",
            text: this.dict.badges.prefixLastFetched,
          })
        );
      }

      const item = createEl(
        "label",
        {
          className: `send-candidate-item${input.checked ? " is-selected" : ""}`,
          attrs: { for: radioId },
        },
        [input, ...badgeNodes]
      );
      nodes.push(item);
    }
    replaceChildrenSafe(this.savedCandidatesListEl, nodes);
  }

  /**
   * Populates the live battery and remaining-storage pills for the selected target badge.
   *
   * @param targetView - Resolved send-target view model.
   */
  private renderTelemetryRow(targetView: SendTargetViewState): void {
    const s = this.dict.send;
    this.telemetryRowEl.hidden = false;
    const batteryVal =
      targetView.liveMetadata?.standardInfo?.batteryPercent !== undefined
        ? `${targetView.liveMetadata.standardInfo.batteryPercent}%`
        : s.valueUnverified;
    const storageVal =
      targetView.liveMetadata?.freeStorageBytes !== null &&
      targetView.liveMetadata?.freeStorageBytes !== undefined
        ? `${(targetView.liveMetadata.freeStorageBytes / 1024).toFixed(1)} KB`
        : s.valueUnverified;

    this.batteryPillEl.textContent = `${s.labelBattery}: ${batteryVal}`;
    this.storagePillEl.textContent = `${s.labelFreeStorage}: ${storageVal}`;
  }

  /**
   * Updates the status callout banner's icon, tonal attribute, heading, and body copy.
   *
   * @param icon - Studio SVG icon name.
   * @param tone - Visual status tone attribute.
   * @param title - Headline copy.
   * @param body - Supporting explanation copy.
   */
  private setStateVisual(
    icon: StudioIconName,
    tone: "ok" | "info" | "warn" | "err" | undefined,
    title: string,
    body: string
  ): void {
    replaceChildrenSafe(this.stateIconWrapEl, [createStudioIcon(icon, 20)]);
    if (tone) {
      this.stateBannerEl.setAttribute("data-tone", tone);
    } else {
      this.stateBannerEl.removeAttribute("data-tone");
    }
    this.stateTitleEl.textContent = title;
    this.stateBodyEl.textContent = body;
    this.stateBodyEl.hidden = body.length === 0;
  }

  /**
   * Swaps an action button's leading icon and label text cleanly.
   *
   * @param handle - Target button handle.
   * @param icon - Studio SVG icon name.
   * @param text - Button label text.
   */
  private configureButton(
    handle: IconButtonHandle,
    icon: StudioIconName,
    text: string
  ): void {
    const prevSvg = handle.button.querySelector("svg");
    const nextSvg = createStudioIcon(icon, 18);
    if (prevSvg && prevSvg.parentNode) {
      prevSvg.parentNode.replaceChild(nextSvg, prevSvg);
    }
    handle.labelEl.textContent = text;
  }
}
