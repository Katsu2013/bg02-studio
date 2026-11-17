/**
 * @module ui/deviceDetailPanel
 * Screen 5 (`activeScreen === "device-detail"`): Individual badge management,
 * nickname renaming, connect/disconnect & Send handoff, auto-reconnect toggles,
 * explicit-confirmation unregistration with honest browser/OS unpair guidance,
 * and collapsed Diagnostics (`<details>`) holding specs, BLE flags, and communication logs.
 */

import { interpolate } from "../i18n/i18n";
import type { TranslationSchema } from "../i18n/types";
import { ALGORITHM_NAMES } from "../constants/ble";
import type { AppStateSnapshot } from "../state/appStore";
import type { SavedBadgeProfile } from "../state/deviceRegistry";
import { resolveBadgeStatusSummary } from "./badgeStatusHelper";
import {
  createButton,
  createEl,
  createIconButton,
  type IconButtonHandle,
} from "./domHelpers";
import { createStudioIcon } from "./icons";

/** Callbacks invoked by Screen 5 (`"device-detail"`) interactions. */
export interface DeviceDetailHandlers {
  /** Navigates back to Screen 4 (`"badges"`). */
  readonly onBackBadges: () => void;
  /** Connects (if needed) to this badge and opens Send/Editor flow targeting it. */
  readonly onSendWithBadge: (deviceId: string) => void;
  /** Connects GATT directly to the inspected badge. */
  readonly onConnectDevice: (deviceId: string) => void;
  /** Opens the Web Bluetooth device picker to re-grant permission when direct reuse fails. */
  readonly onReselectDevice: (deviceId: string) => void;
  /** Disconnects the active GATT session cleanly. */
  readonly onDisconnect: () => void;
  /** Re-queries ClockDialInfo, free storage, battery, and Device Information Service. */
  readonly onRefreshTelemetry: () => void;
  /** Saves an updated badge nickname to storage. */
  readonly onRenameDevice: (deviceId: string, nickname: string) => void;
  /** Removes the badge from browser/app storage and calls `device.forget()` if supported. */
  readonly onForgetDevice: (deviceId: string) => Promise<void>;
  /** Updates automatic reconnect toggles. */
  readonly onUpdateReconnectPrefs: (
    patch: Partial<{ autoRetryOnDrop: boolean; autoConnectOnStartup: boolean }>
  ) => void;
  /** Updates `acceptAllDevices` BLE picker toggle. */
  readonly onToggleAcceptAll: (value: boolean) => void;
  /** Updates `writeValueWithoutResponse` transport mode toggle. */
  readonly onToggleWriteWithoutResponse: (value: boolean) => void;
  /** Copies `chrome://bluetooth-internals/#devices` or diagnostic URL to clipboard. */
  readonly onCopyText: (text: string, announcement: string) => void;
}

/** Row handle pairing a `<dt>` label and `<dd>` value inside the diagnostics `<dl>`. */
export interface SpecRowHandle {
  /** Outer wrapper row container. */
  readonly row: HTMLDivElement;
  /** Metric label `<dt>` element. */
  readonly labelEl: HTMLElement;
  /** Metric value `<dd>` element. */
  readonly valueEl: HTMLElement;
}

function createSpecRow(labelText: string): SpecRowHandle {
  const labelEl = createEl("dt", { text: labelText });
  const valueEl = createEl("dd", { text: "-" });
  const row = createEl("div", { className: "telemetry-row" }, [labelEl, valueEl]);
  return { row, labelEl, valueEl };
}

/**
 * Renders Screen 5 (`"device-detail"`): Details, Unregistration, Unpair Guide & Diagnostics.
 */
export class DeviceDetailPanel {
  /** Root container for Screen 5. */
  public readonly element: HTMLElement;
  /** Explicit `< マイバッジ` Back button exposed for non-scrolling focus placement. */
  public readonly backBtn: HTMLButtonElement;

  /** Active localization schema. */
  private dict: TranslationSchema;
  /** Latest rendered application state snapshot. */
  private lastState: AppStateSnapshot | null = null;
  /** Badge ID currently awaiting confirmation in the inline unregister box. */
  private pendingUnregisterDeviceId: string | null = null;
  /** Whether the inline nickname-saved feedback banner is currently visible. */
  private nicknameSavedVisible = false;

  /** Back button label span returning to My Badges. */
  private readonly backBtnLabelEl: HTMLSpanElement;
  /** Centered top-bar heading element. */
  private readonly topTitleEl: HTMLHeadingElement;

  /** Two-sentence confirmation banner displayed after removing a badge. */
  private readonly forgetBannerEl: HTMLDivElement;
  /** Primary removal sentence confirming deletion from app registry. */
  private readonly forgetRemovedEl: HTMLParagraphElement;
  /** Secondary sentence reporting `device.forget()` permission outcome. */
  private readonly forgetBrowserNoteEl: HTMLParagraphElement;
  /** Back button inside the post-removal banner. */
  private readonly forgetBackBtn: HTMLButtonElement;

  /** Fallback card shown when no matching badge profile exists. */
  private readonly emptyFallbackCardEl: HTMLDivElement;
  /** Fallback explanatory paragraph. */
  private readonly emptyFallbackTextEl: HTMLParagraphElement;

  /** Wrapper holding all detail sections for an active badge profile. */
  private readonly mainContentWrapEl: HTMLDivElement;
  /** Badge display nickname heading. */
  private readonly badgeNameHeadingEl: HTMLHeadingElement;
  /** Live vs disconnected badge status badge pill. */
  private readonly statusPillEl: HTMLSpanElement;
  /** Live, cached prior-session, or unconfirmed battery readout text. */
  private readonly batteryTextEl: HTMLSpanElement;
  /** Toggle connecting or disconnecting this badge over GATT. */
  private readonly connectToggleBtn: IconButtonHandle;
  /** Shortcut button routing straight to editing/sending with this badge selected. */
  private readonly sendWithBadgeBtn: IconButtonHandle;
  /** Inline alert shown on Badge Detail when an explicit connection attempt fails. */
  private readonly detailConnectAlertEl: HTMLDivElement;
  /** Headline paragraph inside the detail connection failure alert. */
  private readonly detailConnectAlertTitleEl: HTMLParagraphElement;
  /** Guidance body inside the detail connection failure alert. */
  private readonly detailConnectAlertBodyEl: HTMLParagraphElement;
  /** Recovery button opening Bluetooth chooser or retrying after power/range check. */
  private readonly detailConnectRecoveryBtn: IconButtonHandle;

  /** Section heading above nickname customization form. */
  private readonly basicSectionTitleEl: HTMLHeadingElement;
  /** Form label element for nickname input. */
  private readonly nicknameLabelEl: HTMLLabelElement;
  /** Badge nickname text input field. */
  private readonly nicknameInputEl: HTMLInputElement;
  /** Submit button saving updated badge nickname. */
  private readonly saveNicknameBtn: HTMLButtonElement;
  /** Inline confirmation text shown after nickname update. */
  private readonly nicknameSavedEl: HTMLParagraphElement;

  /** Section heading for automatic reconnection checkboxes. */
  private readonly autoReconnectTitleEl: HTMLHeadingElement;
  /** Checkbox label for automatic drop-recovery retries. */
  private readonly autoRetryLabelEl: HTMLLabelElement;
  /** Checkbox controlling automatic drop-recovery retries. */
  private readonly autoRetryCheckboxEl: HTMLInputElement;
  /** Checkbox label for silent startup reconnection via `getDevices()`. */
  private readonly autoStartupLabelEl: HTMLLabelElement;
  /** Checkbox controlling startup reconnection via `getDevices()`. */
  private readonly autoStartupCheckboxEl: HTMLInputElement;

  /** Danger-zone unregistration section heading. */
  private readonly unregisterSectionTitleEl: HTMLHeadingElement;
  /** Button opening the inline unregister confirmation box. */
  private readonly unregisterOpenBtn: IconButtonHandle;
  /** Explicit confirmation container naming the badge before removal. */
  private readonly unregisterConfirmBoxEl: HTMLDivElement;
  /** Confirmation prompt paragraph text. */
  private readonly unregisterQuestionEl: HTMLParagraphElement;
  /** Destructive button committing badge unregistration. */
  private readonly unregisterConfirmBtn: HTMLButtonElement;
  /** Cancel button closing the confirmation box safely. */
  private readonly unregisterCancelBtn: HTMLButtonElement;

  /** Accordion summary label for collapsed connection diagnostics. */
  private readonly diagnosticsSummaryEl: HTMLElement;
  /** Action button refreshing live GATT telemetry on demand. */
  private readonly refreshTelemetryBtn: IconButtonHandle;
  /** Firmware/hardware revision telemetry row. */
  private readonly specFirmwareRow: SpecRowHandle;
  /** Display dimensions & algorithm telemetry row. */
  private readonly specDisplayRow: SpecRowHandle;
  /** Free flash storage telemetry row. */
  private readonly specStorageRow: SpecRowHandle;
  /** Hardware/model identifier telemetry row. */
  private readonly specModelRow: SpecRowHandle;
  /** Last synchronization timestamp telemetry row. */
  private readonly specSyncedRow: SpecRowHandle;
  /** Fixed custom dial slot diagnostic row (`5538`). */
  private readonly specCustomSlotRow: SpecRowHandle;
  /** Last completed upload diagnostic row (bytes, duration, CRC checksum). */
  private readonly specLastTransferRow: SpecRowHandle;

  /** Subsection heading above developer BLE transport flags. */
  private readonly bleOptionsHeadingEl: HTMLHeadingElement;
  /** Label for `acceptAllDevices` discovery toggle. */
  private readonly acceptAllLabelEl: HTMLLabelElement;
  /** Checkbox toggling `acceptAllDevices: true` scanning fallback. */
  private readonly acceptAllCheckboxEl: HTMLInputElement;
  /** Label for `writeValueWithoutResponse` transport mode toggle. */
  private readonly writeNoRspLabelEl: HTMLLabelElement;
  /** Checkbox toggling `writeValueWithoutResponse` writes. */
  private readonly writeNoRspCheckboxEl: HTMLInputElement;

  /** Subsection heading above browser/OS unpairing instructions. */
  private readonly unpairGuideHeadingEl: HTMLHeadingElement;
  /** Guidance text describing Chrome permission cleanup. */
  private readonly unpairBrowserBodyEl: HTMLParagraphElement;
  /** Button copying `chrome://bluetooth-internals/#devices` to clipboard. */
  private readonly copyChromeUrlBtn: IconButtonHandle;
  /** Windows Bluetooth unpairing instructions paragraph. */
  private readonly unpairWindowsEl: HTMLParagraphElement;
  /** Android Bluetooth unpairing instructions paragraph. */
  private readonly unpairAndroidEl: HTMLParagraphElement;
  /** macOS / iOS Bluetooth unpairing instructions paragraph. */
  private readonly unpairAppleEl: HTMLParagraphElement;
  /** Wrapper containing browser/OS unpair guidance. */
  private readonly unpairGuideStandaloneCardEl: HTMLDivElement;
  /** Container mounting `LogPanel` inside the diagnostics accordion. */
  private readonly logContainerEl: HTMLDivElement;

  /**
   * Builds Screen 5 DOM nodes, unregistration confirmation flow, and collapsed Diagnostics accordion.
   *
   * @param initialDict - Active localized translation schema.
   * @param handlers - Detail and unpairing callbacks.
   * @param logPanelElement - Live diagnostic `LogPanel.element` mounted inside Diagnostics accordion.
   */
  public constructor(
    initialDict: TranslationSchema,
    handlers: DeviceDetailHandlers,
    logPanelElement: HTMLElement
  ) {
    this.dict = initialDict;

    this.backBtnLabelEl = createEl("span", { text: initialDict.detail.btnBackBadges });
    this.backBtn = createEl("button", { className: "screen-back-btn" }, [
      createStudioIcon("arrowLeft", 18),
      this.backBtnLabelEl,
    ]);
    this.backBtn.type = "button";
    this.backBtn.addEventListener("click", handlers.onBackBadges);

    this.topTitleEl = createEl("h1", {
      className: "screen-top-title",
      text: initialDict.detail.screenTitle,
    });
    const topBar = createEl("div", { className: "screen-top-bar" }, [
      this.backBtn,
      this.topTitleEl,
      createEl("span", { className: "screen-top-spacer", attrs: { "aria-hidden": "true" } }),
    ]);

    // Post-removal honest two-sentence banner
    this.forgetRemovedEl = createEl("p", { className: "forget-primary-msg", text: "" });
    this.forgetBrowserNoteEl = createEl("p", { className: "forget-secondary-msg", text: "" });
    this.forgetBackBtn = createButton("btn btn-secondary", initialDict.detail.btnBackBadges);
    this.forgetBackBtn.addEventListener("click", handlers.onBackBadges);
    this.forgetBannerEl = createEl(
      "div",
      { className: "surface-card detail-forget-banner", attrs: { role: "status", "data-tone": "info" } },
      [this.forgetRemovedEl, this.forgetBrowserNoteEl, this.forgetBackBtn]
    );
    this.forgetBannerEl.hidden = true;

    this.emptyFallbackTextEl = createEl("p", { text: initialDict.detail.noDeviceSelected });
    this.emptyFallbackCardEl = createEl("div", { className: "surface-card" }, [
      this.emptyFallbackTextEl,
    ]);
    this.emptyFallbackCardEl.hidden = true;

    // Hero status card
    this.badgeNameHeadingEl = createEl("h2", { className: "detail-badge-name", text: "" });
    this.statusPillEl = createEl("span", { className: "mini-pill", text: "" });
    this.batteryTextEl = createEl("span", { className: "detail-battery-text", text: "" });
    this.connectToggleBtn = createIconButton("btn btn-secondary", "bluetooth", initialDict.detail.btnConnect, 18);
    this.sendWithBadgeBtn = createIconButton("btn btn-primary", "send", initialDict.detail.btnSendWithBadge, 18);

    this.connectToggleBtn.button.addEventListener("click", () => {
      const profile = this.resolveCurrentProfile(this.lastState);
      if (!profile) return;
      if (this.isProfileConnected(profile.id, this.lastState)) {
        handlers.onDisconnect();
      } else {
        handlers.onConnectDevice(profile.id);
      }
    });
    this.sendWithBadgeBtn.button.addEventListener("click", () => {
      const profile = this.resolveCurrentProfile(this.lastState);
      if (!profile) return;
      handlers.onSendWithBadge(profile.id);
    });

    this.detailConnectAlertTitleEl = createEl("p", { className: "detail-connect-alert-title", text: "" });
    this.detailConnectAlertBodyEl = createEl("p", { className: "detail-connect-alert-body", text: "" });
    this.detailConnectRecoveryBtn = createIconButton(
      "btn btn-sm btn-secondary",
      "bluetooth",
      initialDict.send.btnReselectBluetooth,
      16
    );
    this.detailConnectRecoveryBtn.button.addEventListener("click", () => {
      const profile = this.resolveCurrentProfile(this.lastState);
      if (!profile) return;
      const reason = this.lastState?.sendOutcome?.connectFailureReason;
      if (reason === "permission_unavailable") {
        handlers.onReselectDevice(profile.id);
      } else {
        handlers.onConnectDevice(profile.id);
      }
    });
    this.detailConnectAlertEl = createEl(
      "div",
      { className: "inline-alert detail-connect-alert", attrs: { role: "alert", "data-tone": "err" } },
      [
        createStudioIcon("alert", 18),
        createEl("div", { className: "detail-connect-alert-copy" }, [
          this.detailConnectAlertTitleEl,
          this.detailConnectAlertBodyEl,
          this.detailConnectRecoveryBtn.button,
        ]),
      ]
    );
    this.detailConnectAlertEl.hidden = true;

    const headerSummaryCard = createEl("section", { className: "surface-card detail-hero-card" }, [
      createEl("div", { className: "detail-hero-top" }, [
        this.badgeNameHeadingEl,
        createEl("div", { className: "detail-hero-pills" }, [
          this.statusPillEl,
          this.batteryTextEl,
        ]),
      ]),
      createEl("div", { className: "detail-hero-actions" }, [
        this.sendWithBadgeBtn.button,
        this.connectToggleBtn.button,
      ]),
      this.detailConnectAlertEl,
    ]);

    // Rename & Basic Settings Card
    this.basicSectionTitleEl = createEl("h2", {
      className: "card-section-title",
      text: initialDict.detail.sectionBasic,
    });
    this.nicknameLabelEl = createEl("label", {
      text: initialDict.detail.labelNickname,
      attrs: { for: "detail-nickname-input" },
    });
    this.nicknameInputEl = createEl("input", {
      id: "detail-nickname-input",
      className: "text-input",
      attrs: {
        type: "text",
        maxlength: "32",
        placeholder: initialDict.detail.placeholderNickname,
      },
    });
    this.saveNicknameBtn = createButton("btn btn-secondary", initialDict.detail.btnSaveNickname);
    this.nicknameSavedEl = createEl("p", {
      className: "detail-saved-note",
      text: initialDict.detail.nicknameSavedNotice,
      attrs: { role: "status" },
    });
    this.nicknameSavedEl.hidden = true;

    const handleSaveNickname = (): void => {
      const profile = this.resolveCurrentProfile(this.lastState);
      if (!profile) return;
      const trimmed = this.nicknameInputEl.value.trim();
      if (!trimmed) return;
      handlers.onRenameDevice(profile.id, trimmed);
      this.nicknameSavedVisible = true;
      this.nicknameSavedEl.hidden = false;
    };
    this.saveNicknameBtn.addEventListener("click", handleSaveNickname);
    this.nicknameInputEl.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        handleSaveNickname();
      }
    });

    const renameRow = createEl("div", { className: "detail-rename-row" }, [
      this.nicknameInputEl,
      this.saveNicknameBtn,
    ]);
    const basicCard = createEl("section", { className: "surface-card detail-section-card" }, [
      this.basicSectionTitleEl,
      this.nicknameLabelEl,
      renameRow,
      this.nicknameSavedEl,
    ]);

    // Auto-reconnect Settings Card
    this.autoReconnectTitleEl = createEl("h2", {
      className: "card-section-title",
      text: initialDict.detail.sectionAutoReconnect,
    });
    this.autoRetryCheckboxEl = createEl("input", {
      id: "detail-auto-retry",
      className: "toggle-checkbox",
      attrs: { type: "checkbox" },
    });
    this.autoRetryLabelEl = createEl("label", {
      text: initialDict.detail.optAutoRetryOnDrop,
      attrs: { for: "detail-auto-retry" },
    });
    this.autoStartupCheckboxEl = createEl("input", {
      id: "detail-auto-startup",
      className: "toggle-checkbox",
      attrs: { type: "checkbox" },
    });
    this.autoStartupLabelEl = createEl("label", {
      text: initialDict.detail.optAutoConnectOnStartup,
      attrs: { for: "detail-auto-startup" },
    });

    this.autoRetryCheckboxEl.addEventListener("change", () =>
      handlers.onUpdateReconnectPrefs({ autoRetryOnDrop: this.autoRetryCheckboxEl.checked })
    );
    this.autoStartupCheckboxEl.addEventListener("change", () =>
      handlers.onUpdateReconnectPrefs({ autoConnectOnStartup: this.autoStartupCheckboxEl.checked })
    );

    const autoReconnectCard = createEl("section", { className: "surface-card detail-section-card" }, [
      this.autoReconnectTitleEl,
      createEl("div", { className: "checkbox-row" }, [
        this.autoRetryCheckboxEl,
        this.autoRetryLabelEl,
      ]),
      createEl("div", { className: "checkbox-row" }, [
        this.autoStartupCheckboxEl,
        this.autoStartupLabelEl,
      ]),
    ]);

    // Explicit Unregister Section (no native browser confirm)
    this.unregisterSectionTitleEl = createEl("h2", {
      className: "card-section-title",
      text: initialDict.detail.sectionUnregister,
    });
    this.unregisterOpenBtn = createIconButton(
      "btn btn-danger-outline",
      "unlink",
      initialDict.detail.btnUnregisterOpen,
      18
    );
    this.unregisterQuestionEl = createEl("p", { className: "detail-unregister-question", text: "" });
    this.unregisterConfirmBtn = createButton(
      "btn btn-danger",
      initialDict.detail.btnUnregisterConfirm
    );
    this.unregisterCancelBtn = createButton(
      "btn btn-secondary",
      initialDict.detail.btnUnregisterCancel
    );
    this.unregisterConfirmBoxEl = createEl("div", { className: "detail-unregister-confirm" }, [
      this.unregisterQuestionEl,
      createEl("div", { className: "detail-unregister-actions" }, [
        this.unregisterConfirmBtn,
        this.unregisterCancelBtn,
      ]),
    ]);
    this.unregisterConfirmBoxEl.hidden = true;

    this.unregisterOpenBtn.button.addEventListener("click", () => {
      const profile = this.resolveCurrentProfile(this.lastState);
      if (!profile) return;
      this.pendingUnregisterDeviceId = profile.id;
      this.unregisterQuestionEl.textContent = interpolate(
        this.dict.detail.unregisterConfirmQuestion,
        { name: profile.nickname }
      );
      this.unregisterConfirmBoxEl.hidden = false;
      this.unregisterOpenBtn.button.hidden = true;
    });
    this.unregisterCancelBtn.addEventListener("click", () => {
      this.pendingUnregisterDeviceId = null;
      this.unregisterConfirmBoxEl.hidden = true;
      this.unregisterOpenBtn.button.hidden = false;
    });
    this.unregisterConfirmBtn.addEventListener("click", () => {
      const id = this.pendingUnregisterDeviceId;
      if (!id) return;
      this.pendingUnregisterDeviceId = null;
      void handlers.onForgetDevice(id);
    });

    const unregisterCard = createEl("section", { className: "surface-card detail-section-card" }, [
      this.unregisterSectionTitleEl,
      this.unregisterOpenBtn.button,
      this.unregisterConfirmBoxEl,
    ]);

    this.mainContentWrapEl = createEl("div", { className: "detail-main-stack" }, [
      headerSummaryCard,
      basicCard,
      autoReconnectCard,
      unregisterCard,
    ]);

    // Unpair guide card (shared inside Diagnostics OR visible standalone right after forget notice)
    this.unpairGuideHeadingEl = createEl("h3", {
      className: "card-subsection-title",
      text: initialDict.detail.sectionUnpairGuide,
    });
    this.unpairBrowserBodyEl = createEl("p", {
      className: "details-copy",
      text: initialDict.detail.unpairStepBrowserBody,
    });
    this.copyChromeUrlBtn = createIconButton(
      "btn btn-sm btn-secondary",
      "copy",
      `${initialDict.detail.btnCopyChromeUrl} (${initialDict.detail.unpairChromeUrl})`,
      15
    );
    this.copyChromeUrlBtn.button.addEventListener("click", () => {
      handlers.onCopyText(
        this.dict.detail.unpairChromeUrl,
        this.dict.detail.copiedChromeUrlToast
      );
    });
    this.unpairWindowsEl = createEl("p", {
      className: "details-copy",
      text: initialDict.detail.unpairStepWindows,
    });
    this.unpairAndroidEl = createEl("p", {
      className: "details-copy",
      text: initialDict.detail.unpairStepAndroid,
    });
    this.unpairAppleEl = createEl("p", {
      className: "details-copy",
      text: initialDict.detail.unpairStepApple,
    });

    this.unpairGuideStandaloneCardEl = createEl("div", { className: "unpair-guide-block" }, [
      this.unpairGuideHeadingEl,
      this.unpairBrowserBodyEl,
      this.copyChromeUrlBtn.button,
      this.unpairWindowsEl,
      this.unpairAndroidEl,
      this.unpairAppleEl,
    ]);

    // Collapsed Diagnostics <details>
    this.refreshTelemetryBtn = createIconButton(
      "btn btn-sm btn-secondary",
      "refresh",
      initialDict.detail.btnRefreshTelemetry,
      15
    );
    this.refreshTelemetryBtn.button.addEventListener("click", handlers.onRefreshTelemetry);

    this.specFirmwareRow = createSpecRow(initialDict.detail.labelFirmwareHardware);
    this.specDisplayRow = createSpecRow(initialDict.detail.labelDisplaySpec);
    this.specStorageRow = createSpecRow(initialDict.detail.labelFreeStorage);
    this.specModelRow = createSpecRow(initialDict.detail.labelModelInfo);
    this.specSyncedRow = createSpecRow(initialDict.detail.labelLastSynced);
    this.specCustomSlotRow = createSpecRow(initialDict.detail.labelCustomSlot);
    this.specCustomSlotRow.valueEl.textContent = initialDict.detail.valueCustomSlotFixed;
    this.specLastTransferRow = createSpecRow(initialDict.detail.labelLastTransfer);

    const specList = createEl("dl", { className: "telemetry-dl" }, [
      this.specFirmwareRow.row,
      this.specDisplayRow.row,
      this.specStorageRow.row,
      this.specModelRow.row,
      this.specSyncedRow.row,
      this.specCustomSlotRow.row,
      this.specLastTransferRow.row,
    ]);

    this.bleOptionsHeadingEl = createEl("h3", {
      className: "card-subsection-title",
      text: initialDict.detail.sectionBleOptions,
    });
    this.acceptAllCheckboxEl = createEl("input", {
      id: "detail-accept-all",
      className: "toggle-checkbox",
      attrs: { type: "checkbox" },
    });
    this.acceptAllLabelEl = createEl("label", {
      text: initialDict.detail.optAcceptAllDevices,
      attrs: { for: "detail-accept-all" },
    });
    this.writeNoRspCheckboxEl = createEl("input", {
      id: "detail-write-norsp",
      className: "toggle-checkbox",
      attrs: { type: "checkbox" },
    });
    this.writeNoRspLabelEl = createEl("label", {
      text: initialDict.detail.optPreferWriteWithoutResponse,
      attrs: { for: "detail-write-norsp" },
    });
    this.acceptAllCheckboxEl.addEventListener("change", () =>
      handlers.onToggleAcceptAll(this.acceptAllCheckboxEl.checked)
    );
    this.writeNoRspCheckboxEl.addEventListener("change", () =>
      handlers.onToggleWriteWithoutResponse(this.writeNoRspCheckboxEl.checked)
    );

    this.logContainerEl = createEl("div", { className: "detail-logs-wrap" }, [logPanelElement]);

    this.diagnosticsSummaryEl = createEl("summary", {}, [
      createEl("span", { text: initialDict.detail.diagnosticsSummary }),
    ]);
    const diagnosticsDetails = createEl("details", { className: "surface-card editor-details diagnostics-accordion" }, [
      this.diagnosticsSummaryEl,
      createEl("div", { className: "details-body" }, [
        this.refreshTelemetryBtn.button,
        specList,
        this.bleOptionsHeadingEl,
        createEl("div", { className: "checkbox-row" }, [
          this.acceptAllCheckboxEl,
          this.acceptAllLabelEl,
        ]),
        createEl("div", { className: "checkbox-row" }, [
          this.writeNoRspCheckboxEl,
          this.writeNoRspLabelEl,
        ]),
        this.unpairGuideStandaloneCardEl,
        this.logContainerEl,
      ]),
    ]);

    this.element = createEl(
      "section",
      {
        id: "screen-device-detail",
        className: "screen-view detail-screen",
        attrs: { "aria-label": initialDict.detail.screenTitle },
      },
      [
        topBar,
        this.forgetBannerEl,
        this.emptyFallbackCardEl,
        this.mainContentWrapEl,
        diagnosticsDetails,
      ]
    );
  }

  /**
   * Updates all translated labels across Screen 5 and re-renders.
   *
   * @param nextDict - Updated translation schema.
   * @param state - Latest store snapshot.
   */
  public updateLocale(nextDict: TranslationSchema, state: AppStateSnapshot): void {
    this.dict = nextDict;
    const d = nextDict.detail;
    this.element.setAttribute("aria-label", d.screenTitle);
    this.backBtnLabelEl.textContent = d.btnBackBadges;
    this.topTitleEl.textContent = d.screenTitle;
    this.forgetBackBtn.textContent = d.btnBackBadges;
    this.emptyFallbackTextEl.textContent = d.noDeviceSelected;

    this.sendWithBadgeBtn.labelEl.textContent = d.btnSendWithBadge;
    this.basicSectionTitleEl.textContent = d.sectionBasic;
    this.nicknameLabelEl.textContent = d.labelNickname;
    this.nicknameInputEl.placeholder = d.placeholderNickname;
    this.saveNicknameBtn.textContent = d.btnSaveNickname;

    this.autoReconnectTitleEl.textContent = d.sectionAutoReconnect;
    this.autoRetryLabelEl.textContent = d.optAutoRetryOnDrop;
    this.autoStartupLabelEl.textContent = d.optAutoConnectOnStartup;

    this.unregisterSectionTitleEl.textContent = d.sectionUnregister;
    this.unregisterOpenBtn.labelEl.textContent = d.btnUnregisterOpen;
    this.unregisterCancelBtn.textContent = d.btnUnregisterCancel;

    this.diagnosticsSummaryEl.firstElementChild!.textContent = d.diagnosticsSummary;
    this.refreshTelemetryBtn.labelEl.textContent = d.btnRefreshTelemetry;
    this.specFirmwareRow.labelEl.textContent = d.labelFirmwareHardware;
    this.specDisplayRow.labelEl.textContent = d.labelDisplaySpec;
    this.specStorageRow.labelEl.textContent = d.labelFreeStorage;
    this.specModelRow.labelEl.textContent = d.labelModelInfo;
    this.specSyncedRow.labelEl.textContent = d.labelLastSynced;
    this.specCustomSlotRow.labelEl.textContent = d.labelCustomSlot;
    this.specCustomSlotRow.valueEl.textContent = d.valueCustomSlotFixed;
    this.specLastTransferRow.labelEl.textContent = d.labelLastTransfer;

    this.bleOptionsHeadingEl.textContent = d.sectionBleOptions;
    this.acceptAllLabelEl.textContent = d.optAcceptAllDevices;
    this.writeNoRspLabelEl.textContent = d.optPreferWriteWithoutResponse;

    this.unpairGuideHeadingEl.textContent = d.sectionUnpairGuide;
    this.unpairBrowserBodyEl.textContent = d.unpairStepBrowserBody;
    this.copyChromeUrlBtn.labelEl.textContent = `${d.btnCopyChromeUrl} (${d.unpairChromeUrl})`;
    this.unpairWindowsEl.textContent = d.unpairStepWindows;
    this.unpairAndroidEl.textContent = d.unpairStepAndroid;
    this.unpairAppleEl.textContent = d.unpairStepApple;

    this.render(state);
  }

  /**
   * Updates inspected badge fields, unregistration notice, and connection/diagnostic specs.
   *
   * @param state - Latest store snapshot.
   */
  public render(state: AppStateSnapshot): void {
    this.lastState = state;
    const d = this.dict.detail;

    // Reset pending unregister confirmation if focus switched to another badge
    if (this.pendingUnregisterDeviceId && this.pendingUnregisterDeviceId !== state.detailDeviceId) {
      this.pendingUnregisterDeviceId = null;
      this.unregisterConfirmBoxEl.hidden = true;
      this.unregisterOpenBtn.button.hidden = false;
      this.nicknameSavedVisible = false;
      this.nicknameSavedEl.hidden = true;
    }

    if (state.detailForgetNotice) {
      this.forgetBannerEl.hidden = false;
      this.forgetRemovedEl.textContent = interpolate(d.removedFromAppNotice, {
        name: state.detailForgetNotice.deviceName,
      });
      this.forgetBrowserNoteEl.textContent = state.detailForgetNotice.browserPermissionRevoked
        ? d.browserPermissionRevokedNotice
        : d.browserPermissionManualNotice;
    } else {
      this.forgetBannerEl.hidden = true;
    }

    const profile = this.resolveCurrentProfile(state);
    if (!profile) {
      this.emptyFallbackCardEl.hidden = Boolean(state.detailForgetNotice);
      this.mainContentWrapEl.hidden = true;
      this.detailConnectAlertEl.hidden = true;
      this.specLastTransferRow.valueEl.textContent = "-";
      this.acceptAllCheckboxEl.checked = state.acceptAllDevices;
      this.writeNoRspCheckboxEl.checked = state.preferWriteWithoutResponse;
      this.refreshTelemetryBtn.button.disabled = true;
      return;
    }

    this.emptyFallbackCardEl.hidden = true;
    this.mainContentWrapEl.hidden = false;

    const summary = resolveBadgeStatusSummary(profile, state, this.dict);
    this.badgeNameHeadingEl.textContent = profile.nickname;
    this.statusPillEl.textContent = summary.statusLabel;
    if (summary.tone) {
      this.statusPillEl.setAttribute("data-tone", summary.tone);
    } else {
      this.statusPillEl.removeAttribute("data-tone");
    }
    this.batteryTextEl.textContent = summary.batteryText;

    const isConnecting = state.connectionStatus === "connecting";
    const isBusy = Boolean(state.uploadProgress);
    this.connectToggleBtn.labelEl.textContent = summary.isConnectedHere
      ? d.btnDisconnect
      : d.btnConnect;
    this.connectToggleBtn.button.disabled = isConnecting || isBusy;
    this.sendWithBadgeBtn.button.disabled = isConnecting || isBusy;

    const connectFailure =
      !summary.isConnectedHere &&
      !isConnecting &&
      state.sendOutcome?.kind === "connect_failed" &&
      state.sendOutcome.targetDeviceId === profile.id
        ? state.sendOutcome
        : null;
    if (connectFailure) {
      this.detailConnectAlertEl.hidden = false;
      this.detailConnectAlertTitleEl.textContent = interpolate(
        this.dict.send.stateConnectFailedTitle,
        { name: profile.nickname }
      );
      if (connectFailure.connectFailureReason === "permission_unavailable") {
        this.detailConnectAlertBodyEl.textContent = this.dict.send.connectPermissionUnavailableBody;
        this.detailConnectRecoveryBtn.labelEl.textContent = this.dict.send.btnReselectBluetooth;
      } else {
        this.detailConnectAlertBodyEl.textContent = this.dict.send.connectGattFailedBody;
        this.detailConnectRecoveryBtn.labelEl.textContent = this.dict.send.btnRetryPowerRange;
      }
    } else {
      this.detailConnectAlertEl.hidden = true;
    }

    if (document.activeElement !== this.nicknameInputEl) {
      this.nicknameInputEl.value = profile.nickname;
    }
    this.nicknameSavedEl.textContent = interpolate(d.nicknameSavedNotice, {
      name: profile.nickname,
    });
    this.nicknameSavedEl.hidden = !this.nicknameSavedVisible;
    this.unregisterQuestionEl.textContent = interpolate(d.unregisterConfirmQuestion, {
      name: profile.nickname,
    });
    this.unregisterConfirmBtn.textContent = interpolate(d.btnUnregisterConfirm, {
      name: profile.nickname,
    });

    this.autoRetryCheckboxEl.checked = state.reconnectPrefs.autoRetryOnDrop;
    this.autoStartupCheckboxEl.checked = state.reconnectPrefs.autoConnectOnStartup;

    this.acceptAllCheckboxEl.checked = state.acceptAllDevices;
    this.writeNoRspCheckboxEl.checked = state.preferWriteWithoutResponse;
    this.refreshTelemetryBtn.button.disabled = !summary.isConnectedHere || isBusy;

    // Diagnostics <dl> values strictly isolated to THIS profile when disconnected
    if (summary.isConnectedHere && state.metadata) {
      const m = state.metadata;
      const fw = m.standardInfo?.firmwareRevision;
      const hw = m.standardInfo?.hardwareRevision;
      this.specFirmwareRow.valueEl.textContent =
        fw || hw ? `${fw ?? "-"} / ${hw ?? "-"}` : d.valueUnverified;

      if (m.dialInfo) {
        const algoNum = m.dialInfo.algorithm ?? -1;
        const algoName = ALGORITHM_NAMES[algoNum] ?? `#${algoNum}`;
        this.specDisplayRow.valueEl.textContent = `${m.dialInfo.width}×${m.dialInfo.height} (${algoName})`;
      } else {
        this.specDisplayRow.valueEl.textContent = d.valueUnverified;
      }

      if (m.freeStorageBytes !== null && m.freeStorageBytes !== undefined) {
        this.specStorageRow.valueEl.textContent = `${(m.freeStorageBytes / 1024).toFixed(1)} KB (${m.freeStorageBytes.toLocaleString()} B)`;
      } else if (m.freeStorageError) {
        this.specStorageRow.valueEl.textContent = d.freeStorageTimedOut;
      } else {
        this.specStorageRow.valueEl.textContent = d.valueUnverified;
      }

      const modelParts = [
        m.standardInfo?.manufacturer,
        m.standardInfo?.model,
        m.deviceId,
      ].filter((p): p is string => Boolean(p && p.trim().length > 0));
      this.specModelRow.valueEl.textContent =
        modelParts.length > 0 ? modelParts.join(" · ") : d.valueUnverified;
      this.specSyncedRow.valueEl.textContent = new Date().toLocaleTimeString();
    } else {
      this.specFirmwareRow.valueEl.textContent = profile.lastFirmwareRevision ?? d.valueNotSynced;
      this.specDisplayRow.valueEl.textContent = profile.lastDisplaySpec
        ? `${this.dict.badges.prefixLastFetched} ${profile.lastDisplaySpec}`
        : d.valueNotSynced;
      this.specStorageRow.valueEl.textContent =
        profile.lastFreeStorageBytes !== null && profile.lastFreeStorageBytes !== undefined
          ? `${this.dict.badges.prefixLastFetched} ${(profile.lastFreeStorageBytes / 1024).toFixed(1)} KB`
          : d.valueNotSynced;
      this.specModelRow.valueEl.textContent = profile.id;
      this.specSyncedRow.valueEl.textContent = profile.lastConnectedAtMs
        ? `${this.dict.badges.prefixLastFetched} ${new Date(profile.lastConnectedAtMs).toLocaleString()}`
        : d.valueNotSynced;
    }

    const transfer =
      state.lastCompletedTransfer && state.lastCompletedTransfer.targetDeviceId === profile.id
        ? state.lastCompletedTransfer
        : null;
    this.specLastTransferRow.valueEl.textContent = transfer
      ? interpolate(d.valueLastTransferMeta, {
          bytes: transfer.byteLength.toLocaleString(),
          seconds: transfer.durationSec,
          checksum: transfer.checksumHex,
        })
      : "-";
  }

  /** Resolves the currently focused saved badge profile from store state. */
  private resolveCurrentProfile(state: AppStateSnapshot | null): SavedBadgeProfile | null {
    if (!state || state.savedDevices.length === 0) return null;
    if (state.detailDeviceId) {
      const found = state.savedDevices.find((d) => d.id === state.detailDeviceId);
      if (found) return found;
    }
    return null;
  }

  /** Returns whether `deviceId` matches the active live GATT connection. */
  private isProfileConnected(deviceId: string, state: AppStateSnapshot | null): boolean {
    return Boolean(
      state &&
        state.connectionStatus === "connected" &&
        state.activeDeviceId === deviceId &&
        state.metadata?.deviceId === deviceId
    );
  }
}
