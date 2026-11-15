/**
 * @module ui/deviceDetailPanel
 * Screen 3 (`activeScreen === "device-detail"`): Detailed device specifications,
 * nickname renaming, auto-reconnect toggles, step-by-step browser & OS Bluetooth
 * unpairing instructions (`BluetoothDevice.forget()`), and collapsible developer tools.
 */

import { interpolate } from "../i18n/i18n";
import type { TranslationSchema } from "../i18n/types";
import type { AppStateSnapshot } from "../state/appStore";
import type { SavedBadgeProfile } from "../state/deviceRegistry";
import { createButton, createEl, createIconButton, type IconButtonHandle } from "./domHelpers";
import { createStudioIcon } from "./icons";

/** Callbacks dispatched by {@link DeviceDetailPanel} controls. */
export interface DeviceDetailHandlers {
  /** Returns to Screen 1 (`"home"`). */
  readonly onBack: () => void;
  /** Opens Screen 2 (`"push"`) after connecting to the inspected badge. */
  readonly onConnectAndSend: (deviceId: string) => void;
  /** Connects or reconnects to the specified saved badge without leaving Detail view. */
  readonly onConnectDevice: (deviceId: string) => void;
  /** Disconnects the currently open BLE GATT session. */
  readonly onDisconnect: () => void;
  /** Re-queries Dial Info, Free Storage, Battery Level, and DIS telemetry. */
  readonly onRefreshTelemetry: () => void;
  /** Renames a saved badge nickname cleanly. */
  readonly onRenameDevice: (deviceId: string, nextNickname: string) => void;
  /** Removes a badge from storage and invokes `device.forget()` when supported. */
  readonly onForgetDevice: (deviceId: string) => Promise<boolean>;
  /** Updates auto-retry / auto-connect preferences. */
  readonly onUpdateReconnectPrefs: (
    patch: Partial<{ autoRetryOnDrop: boolean; autoConnectOnStartup: boolean }>
  ) => void;
  /** Updates `acceptAllDevices` scan filter toggle. */
  readonly onToggleAcceptAll: (value: boolean) => void;
  /** Updates `writeValueWithoutResponse` pacing preference. */
  readonly onToggleWriteWithoutResponse: (value: boolean) => void;
  /** Copies a helper string (e.g. `chrome://settings/...`) to clipboard cleanly. */
  readonly onCopyText: (text: string, announcement: string) => void;
}

/** Handle exposing a clean hardware specification definition row (`<dt>` + `<dd>`). */
export interface SpecRowHandle {
  /** Outer grid container wrapping label and value. */
  readonly row: HTMLDivElement;
  /** Specification field name element (`<dt>`). */
  readonly labelEl: HTMLElement;
  /** Formatted specification value element (`<dd>`). */
  readonly valueEl: HTMLElement;
}

/** Transient inline banner state shown inside Step 1 after forgetting a saved badge. */
export interface ForgetFeedbackNotice {
  /** Localized confirmation message detailing whether `device.forget()` succeeded. */
  readonly text: string;
  /** Visual alert tone (`"ok"` when browser revoked permission, `"info"` when manual Step 2 needed). */
  readonly tone: "ok" | "info";
}

/**
 * Helper building a clean definition row (`<dt>` + `<dd>`) inside Device Specifications `<dl>`.
 *
 * @param labelText - Initial localized specification key label.
 * @returns Pair exposing label `<dt>` and mutable value `<dd>` elements.
 */
function createSpecRow(labelText: string): SpecRowHandle {
  const labelEl = createEl("dt", { text: labelText });
  const valueEl = createEl("dd", { text: "-" });
  const row = createEl("div", { className: "telemetry-row" }, [labelEl, valueEl]);
  return { row, labelEl, valueEl };
}

/**
 * Renders Screen 3 (`"device-detail"`) encapsulating device specs, nickname editor,
 * Bluetooth unpair instructions, and collapsed-by-default developer BLE diagnostics.
 */
export class DeviceDetailPanel {
  /** Root container mounted into the screen stack. */
  public readonly element: HTMLElement;
  /** Explicit `<` Back button exposed for focus restoration (`focus({ preventScroll: true })`). */
  public readonly backBtn: HTMLButtonElement;

  /** Active locale dictionary. */
  private dict: TranslationSchema;
  /** Latest snapshot cache used when toggling inline rename locally. */
  private lastState: AppStateSnapshot | null = null;
  /** True while the inline nickname editor form is expanded. */
  private isEditingNickname = false;
  /** Inline feedback message shown after forgetting a badge cleanly. */
  private forgetFeedbackMessage: ForgetFeedbackNotice | null = null;

  /** Top bar centered Detail screen title heading. */
  private readonly topBarTitleEl: HTMLHeadingElement;
  /** Fallback notice shown when Detail/Unpair is opened with zero registered badges. */
  private readonly emptyNoticeCard: HTMLElement;
  /** Empty-state title heading (`<h3>`). */
  private readonly emptyTitleEl: HTMLHeadingElement;
  /** Empty-state instructional guidance paragraph. */
  private readonly emptyHintEl: HTMLParagraphElement;
  /** Empty-state CTA returning to Home to connect a badge. */
  private readonly emptyConnectBtn: IconButtonHandle;

  /** Card 1 wrapper containing active badge status, rename, and reconnect controls. */
  private readonly statusCardEl: HTMLElement;
  /** Kicker label (`<h3>`) above Card 1 controls. */
  private readonly statusSectionHeadingEl: HTMLHeadingElement;
  /** Inspected badge nickname display heading (`<h3>`). */
  private readonly deviceNameDisplayEl: HTMLHeadingElement;
  /** Icon button opening the inline nickname editor. */
  private readonly renameToggleBtn: HTMLButtonElement;
  /** Inline nickname form container. */
  private readonly renameFormEl: HTMLDivElement;
  /** Nickname text input element. */
  private readonly renameInputEl: HTMLInputElement;
  /** Confirm button saving an edited nickname. */
  private readonly renameSaveBtn: IconButtonHandle;
  /** Cancel button closing the inline nickname form. */
  private readonly renameCancelBtn: IconButtonHandle;
  /** Connection state pill (`Connected` / `Disconnected`). */
  private readonly statusPillEl: HTMLSpanElement;
  /** Battery level status pill (`Battery: 85%`). */
  private readonly batteryPillEl: HTMLSpanElement;
  /** Last successful sync timestamp readout. */
  private readonly lastSyncedEl: HTMLSpanElement;
  /** Button jumping straight into Image Select & Push for the inspected badge. */
  private readonly sendWithDeviceBtn: IconButtonHandle;
  /** Button connecting or reconnecting to the inspected badge. */
  private readonly connectBtn: IconButtonHandle;
  /** Button cleanly disconnecting from the inspected badge. */
  private readonly disconnectBtn: IconButtonHandle;
  /** Checkbox toggling automatic drop recovery retries (`up to 3x`). */
  private readonly autoRetryCheckbox: HTMLInputElement;
  /** Label text span beside `autoRetryCheckbox`. */
  private readonly autoRetryLabelSpan: HTMLSpanElement;
  /** Checkbox toggling automatic startup reconnect to last active badge. */
  private readonly autoStartupCheckbox: HTMLInputElement;
  /** Label text span beside `autoStartupCheckbox`. */
  private readonly autoStartupLabelSpan: HTMLSpanElement;

  /** Card 2 wrapper showing queried/cached hardware telemetry specifications. */
  private readonly specsCardEl: HTMLElement;
  /** Kicker label (`<h3>`) above Device Specifications `<dl>`. */
  private readonly specsSectionHeadingEl: HTMLHeadingElement;
  /** Badge pill indicating offline cached telemetry values. */
  private readonly cachedInfoPillEl: HTMLSpanElement;
  /** Button re-querying Dial Info, Storage, Battery, and DIS telemetry. */
  private readonly refreshBtn: IconButtonHandle;
  /** Definition row displaying battery percentage. */
  private readonly specBatteryRow: SpecRowHandle;
  /** Definition row displaying FW/HW revision strings. */
  private readonly specFwHwRow: SpecRowHandle;
  /** Definition row displaying screen dimensions, shape, and codec. */
  private readonly specDisplayRow: SpecRowHandle;
  /** Definition row displaying free flash storage bytes/KB. */
  private readonly specStorageRow: SpecRowHandle;
  /** Definition row displaying MCU / customer / OEM strings. */
  private readonly specModelRow: SpecRowHandle;

  /** Card 3 heading (`<h3>`) introducing the Bluetooth unpair steps. */
  private readonly unpairSectionHeadingEl: HTMLHeadingElement;
  /** Intro paragraph explaining browser vs. OS Bluetooth pairing scopes. */
  private readonly unpairIntroEl: HTMLParagraphElement;
  /** Step 1 heading (`<h4>`) for in-app removal & `device.forget()`. */
  private readonly unpairStep1TitleEl: HTMLHeadingElement;
  /** Step 1 descriptive paragraph. */
  private readonly unpairStep1BodyEl: HTMLParagraphElement;
  /** Danger button removing the badge and calling `device.forget()`. */
  private readonly forgetBtn: IconButtonHandle;
  /** Inline feedback banner summarizing `device.forget()` outcome. */
  private readonly forgetNoticeEl: HTMLDivElement;
  /** Step 2 heading (`<h4>`) for Chrome/Edge site permission reset. */
  private readonly unpairStep2TitleEl: HTMLHeadingElement;
  /** Step 2 descriptive paragraph. */
  private readonly unpairStep2BodyEl: HTMLParagraphElement;
  /** Monospace `<code>` displaying the internal Chrome Bluetooth settings URL. */
  private readonly chromeUrlCodeEl: HTMLElement;
  /** Button copying the internal Chrome Bluetooth settings URL to clipboard. */
  private readonly copyChromeUrlBtn: IconButtonHandle;
  /** Step 3 heading (`<h4>`) for OS Bluetooth settings unpairing steps. */
  private readonly unpairStep3TitleEl: HTMLHeadingElement;
  /** Windows 11/10 unpairing instruction list item. */
  private readonly osWindowsEl: HTMLLIElement;
  /** Android unpairing instruction list item. */
  private readonly osAndroidEl: HTMLLIElement;
  /** macOS / iOS / Bluefy unpairing instruction list item. */
  private readonly osAppleEl: HTMLLIElement;

  /** `<summary>` label text gating collapsed developer BLE flags & logs. */
  private readonly devSummaryTitleEl: HTMLSpanElement;
  /** Checkbox toggling `acceptAllDevices: true` scan filter mode. */
  private readonly acceptAllCheckbox: HTMLInputElement;
  /** Label text span beside `acceptAllCheckbox`. */
  private readonly acceptAllLabelSpan: HTMLSpanElement;
  /** Checkbox prioritizing `writeValueWithoutResponse` + 6ms pacing. */
  private readonly preferNoRspCheckbox: HTMLInputElement;
  /** Label text span beside `preferNoRspCheckbox`. */
  private readonly preferNoRspLabelSpan: HTMLSpanElement;

  /**
   * Builds Screen 3 (`"device-detail"`) with top navigation bar, device info card,
   * Bluetooth unpairing guide, and collapsible developer diagnostics `<details>`.
   *
   * @param initialDict - Initial translation dictionary.
   * @param initialState - Initial store snapshot.
   * @param logPanelEl - Pre-built communication log DOM container tucked inside developer `<details>`.
   * @param handlers - User action handlers.
   */
  public constructor(
    initialDict: TranslationSchema,
    initialState: AppStateSnapshot,
    logPanelEl: HTMLElement,
    handlers: DeviceDetailHandlers
  ) {
    this.dict = initialDict;
    this.lastState = initialState;

    const d = initialDict.detail;
    const c = initialDict.connection;

    // Top Navigation Bar (< 12% height, single row per content-first-noise-reduction)
    this.backBtn = createButton("btn-back-circle");
    this.backBtn.setAttribute("aria-label", initialDict.header.btnBack);
    this.backBtn.appendChild(createStudioIcon("arrowLeft", 20));
    this.backBtn.addEventListener("click", () => handlers.onBack());

    this.topBarTitleEl = createEl("h2", {
      className: "subbar-title",
      text: d.screenTitle,
    });
    const topBarSpacer = createEl("span", {
      className: "subbar-spacer",
      attrs: { "aria-hidden": "true" },
    });
    const topBarEl = createEl("div", { className: "subscreen-topbar" }, [
      this.backBtn,
      this.topBarTitleEl,
      topBarSpacer,
    ]);

    // Empty fallback card (shown if user opens Unpair Guide before pairing any badge)
    this.emptyTitleEl = createEl("h3", {
      className: "panel-subtitle",
      text: d.noDeviceSelectedTitle,
    });
    this.emptyHintEl = createEl("p", {
      className: "tip-note",
      text: d.noDeviceSelectedHint,
    });
    this.emptyConnectBtn = createIconButton("btn btn-primary", "bluetooth", initialDict.home.btnConnectNew, 15);
    this.emptyConnectBtn.button.addEventListener("click", () => handlers.onBack());
    this.emptyNoticeCard = createEl("section", { className: "panel-card" }, [
      this.emptyTitleEl,
      this.emptyHintEl,
      createEl("div", { className: "btn-row" }, [this.emptyConnectBtn.button]),
    ]);

    // Card 1: Status, Rename, Controls & Auto-Reconnect
    this.statusSectionHeadingEl = createEl("h3", {
      className: "section-kicker",
      text: d.sectionStatus,
    });
    this.deviceNameDisplayEl = createEl("h3", { className: "detail-device-name", text: "BG02" });
    this.renameToggleBtn = createButton("chip-icon-btn");
    this.renameToggleBtn.setAttribute("aria-label", c.btnRenameDevice);
    this.renameToggleBtn.appendChild(createStudioIcon("edit", 15));
    this.renameToggleBtn.addEventListener("click", () => {
      this.isEditingNickname = true;
      const profile = this.resolveTargetProfile(this.lastState);
      this.renameInputEl.value = profile?.nickname ?? "BG02";
      this.syncRenameVisibility();
      queueMicrotask(() => {
        this.renameInputEl.focus();
        this.renameInputEl.select();
      });
    });

    this.renameInputEl = createEl("input", {
      className: "chip-rename-input",
      attrs: {
        type: "text",
        maxlength: "32",
        placeholder: c.renamePlaceholder,
        "aria-label": c.btnRenameDevice,
      },
    });
    const commitRename = (): void => {
      const profile = this.resolveTargetProfile(this.lastState);
      const next = this.renameInputEl.value.trim();
      this.isEditingNickname = false;
      this.syncRenameVisibility();
      if (profile && next && next !== profile.nickname) {
        handlers.onRenameDevice(profile.id, next);
      }
    };
    const cancelRename = (): void => {
      this.isEditingNickname = false;
      this.syncRenameVisibility();
    };
    this.renameInputEl.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        commitRename();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        cancelRename();
      }
    });
    this.renameSaveBtn = createIconButton("btn btn-sm btn-primary", "check", c.btnSaveNickname, 14);
    this.renameSaveBtn.button.addEventListener("click", commitRename);
    this.renameCancelBtn = createIconButton("btn btn-sm", "close", c.btnCancelRename, 14);
    this.renameCancelBtn.button.addEventListener("click", cancelRename);

    this.renameFormEl = createEl(
      "div",
      { className: "chip-rename-form", attrs: { hidden: "" } },
      [this.renameInputEl, this.renameSaveBtn.button, this.renameCancelBtn.button]
    );

    const nameTitleRow = createEl("div", { className: "detail-name-row" }, [
      this.deviceNameDisplayEl,
      this.renameToggleBtn,
    ]);

    this.statusPillEl = createEl("span", { className: "pill-badge", text: c.statusDisconnected });
    this.batteryPillEl = createEl("span", { className: "pill-badge", text: c.valueNotRead });
    this.lastSyncedEl = createEl("span", { className: "hint-caption", text: "" });

    this.sendWithDeviceBtn = createIconButton(
      "btn btn-primary",
      "send",
      d.btnSendWithThisDevice,
      15
    );
    this.sendWithDeviceBtn.button.addEventListener("click", () => {
      const profile = this.resolveTargetProfile(this.lastState);
      if (profile) {
        handlers.onConnectAndSend(profile.id);
      }
    });
    this.connectBtn = createIconButton("btn", "bluetooth", c.btnReconnect, 15);
    this.connectBtn.button.addEventListener("click", () => {
      const profile = this.resolveTargetProfile(this.lastState);
      if (profile) {
        handlers.onConnectDevice(profile.id);
      }
    });
    this.disconnectBtn = createIconButton("btn", "power", c.btnDisconnect, 15);
    this.disconnectBtn.button.addEventListener("click", () => handlers.onDisconnect());

    this.autoRetryCheckbox = createEl("input", {
      id: "detail-opt-auto-retry",
      attrs: { type: "checkbox" },
    });
    this.autoRetryCheckbox.checked = initialState.reconnectPrefs.autoRetryOnDrop;
    this.autoRetryLabelSpan = createEl("span", { text: c.optAutoRetryOnDrop });
    this.autoRetryCheckbox.addEventListener("change", () => {
      handlers.onUpdateReconnectPrefs({ autoRetryOnDrop: this.autoRetryCheckbox.checked });
    });

    this.autoStartupCheckbox = createEl("input", {
      id: "detail-opt-auto-startup",
      attrs: { type: "checkbox" },
    });
    this.autoStartupCheckbox.checked = initialState.reconnectPrefs.autoConnectOnStartup;
    this.autoStartupLabelSpan = createEl("span", { text: c.optAutoConnectOnStartup });
    this.autoStartupCheckbox.addEventListener("change", () => {
      handlers.onUpdateReconnectPrefs({ autoConnectOnStartup: this.autoStartupCheckbox.checked });
    });

    this.statusCardEl = createEl("section", { className: "panel-card" }, [
      this.statusSectionHeadingEl,
      nameTitleRow,
      this.renameFormEl,
      createEl("div", { className: "detail-meta-strip" }, [
        this.statusPillEl,
        this.batteryPillEl,
        this.lastSyncedEl,
      ]),
      createEl("div", { className: "btn-row" }, [
        this.sendWithDeviceBtn.button,
        this.connectBtn.button,
        this.disconnectBtn.button,
      ]),
      createEl("div", { className: "option-list" }, [
        createEl("label", { className: "check-row", attrs: { for: "detail-opt-auto-retry" } }, [
          this.autoRetryCheckbox,
          this.autoRetryLabelSpan,
        ]),
        createEl("label", { className: "check-row", attrs: { for: "detail-opt-auto-startup" } }, [
          this.autoStartupCheckbox,
          this.autoStartupLabelSpan,
        ]),
      ]),
    ]);

    // Card 2: Hardware Telemetry Specs
    this.specsSectionHeadingEl = createEl("h3", {
      className: "section-kicker",
      text: d.sectionSpecs,
    });
    this.cachedInfoPillEl = createEl("span", {
      className: "pill-badge",
      text: d.cachedInfoBadge,
      attrs: { hidden: "" },
    });
    this.refreshBtn = createIconButton("btn btn-sm", "refresh", c.btnRefreshTelemetry, 14);
    this.refreshBtn.button.addEventListener("click", () => handlers.onRefreshTelemetry());

    this.specBatteryRow = createSpecRow(c.labelBattery);
    this.specFwHwRow = createSpecRow(c.labelFirmwareHardware);
    this.specDisplayRow = createSpecRow(c.labelDisplaySpec);
    this.specStorageRow = createSpecRow(c.labelFreeStorage);
    this.specModelRow = createSpecRow(c.labelModelInfo);

    const specListEl = createEl("dl", { className: "telemetry-grid detail-spec-grid" }, [
      this.specBatteryRow.row,
      this.specFwHwRow.row,
      this.specDisplayRow.row,
      this.specStorageRow.row,
      this.specModelRow.row,
    ]);

    this.specsCardEl = createEl("section", { className: "panel-card" }, [
      createEl("div", { className: "detail-card-head" }, [
        createEl("div", { className: "detail-card-title-row" }, [
          this.specsSectionHeadingEl,
          this.cachedInfoPillEl,
        ]),
        this.refreshBtn.button,
      ]),
      specListEl,
    ]);

    // Card 3: Bluetooth Unpair Instructions + device.forget() Action
    this.unpairSectionHeadingEl = createEl("h3", {
      className: "panel-title-sm",
      text: d.sectionUnpair,
    });
    this.unpairIntroEl = createEl("p", { className: "tip-note", text: d.unpairIntro });

    this.unpairStep1TitleEl = createEl("h4", {
      className: "unpair-step-title",
      text: d.unpairStep1Title,
    });
    this.unpairStep1BodyEl = createEl("p", { className: "unpair-step-body", text: d.unpairStep1Body });
    this.forgetBtn = createIconButton("btn btn-danger", "trash", d.btnForgetThisBadge, 15);
    this.forgetBtn.button.addEventListener("click", async () => {
      const profile = this.resolveTargetProfile(this.lastState);
      if (!profile) {
        return;
      }
      const badgeName = profile.nickname;
      const browserRevoked = await handlers.onForgetDevice(profile.id);
      this.forgetFeedbackMessage = {
        text: interpolate(
          browserRevoked
            ? this.dict.detail.forgetResultBrowserRevoked
            : this.dict.detail.forgetResultLocalOnly,
          { name: badgeName }
        ),
        tone: browserRevoked ? "ok" : "info",
      };
      this.renderForgetNotice();
    });
    this.forgetNoticeEl = createEl("div", {
      className: "banner-alert",
      attrs: { hidden: "", role: "status" },
    });

    this.unpairStep2TitleEl = createEl("h4", {
      className: "unpair-step-title",
      text: d.unpairStep2Title,
    });
    this.unpairStep2BodyEl = createEl("p", { className: "unpair-step-body", text: d.unpairStep2Body });
    this.chromeUrlCodeEl = createEl("code", {
      className: "chrome-url-code",
      text: d.unpairChromeUrl,
    });
    this.copyChromeUrlBtn = createIconButton("btn btn-sm", "copy", d.btnCopyChromeUrl, 14);
    this.copyChromeUrlBtn.button.addEventListener("click", () => {
      handlers.onCopyText(this.dict.detail.unpairChromeUrl, this.dict.detail.copiedChromeUrlToast);
    });

    this.unpairStep3TitleEl = createEl("h4", {
      className: "unpair-step-title",
      text: d.unpairStep3Title,
    });
    this.osWindowsEl = createEl("li", { text: d.unpairStep3Windows });
    this.osAndroidEl = createEl("li", { text: d.unpairStep3Android });
    this.osAppleEl = createEl("li", { text: d.unpairStep3Apple });

    const unpairCardEl = createEl("section", { className: "panel-card unpair-guide-card" }, [
      this.unpairSectionHeadingEl,
      this.unpairIntroEl,
      createEl("div", { className: "unpair-step-block" }, [
        this.unpairStep1TitleEl,
        this.unpairStep1BodyEl,
        createEl("div", { className: "btn-row" }, [this.forgetBtn.button]),
        this.forgetNoticeEl,
      ]),
      createEl("div", { className: "unpair-step-block" }, [
        this.unpairStep2TitleEl,
        this.unpairStep2BodyEl,
        createEl("div", { className: "chrome-url-row" }, [
          this.chromeUrlCodeEl,
          this.copyChromeUrlBtn.button,
        ]),
      ]),
      createEl("div", { className: "unpair-step-block" }, [
        this.unpairStep3TitleEl,
        createEl("ul", { className: "unpair-os-list" }, [
          this.osWindowsEl,
          this.osAndroidEl,
          this.osAppleEl,
        ]),
      ]),
    ]);

    // Card 4: Collapsed Developer Tools (<details> — no heading inside <summary>, marker next to label)
    this.acceptAllCheckbox = createEl("input", {
      id: "detail-opt-accept-all",
      attrs: { type: "checkbox" },
    });
    this.acceptAllCheckbox.checked = initialState.acceptAllDevices;
    this.acceptAllLabelSpan = createEl("span", { text: c.optAcceptAllDevices });
    this.acceptAllCheckbox.addEventListener("change", () => {
      handlers.onToggleAcceptAll(this.acceptAllCheckbox.checked);
    });

    this.preferNoRspCheckbox = createEl("input", {
      id: "detail-opt-write-no-rsp",
      attrs: { type: "checkbox" },
    });
    this.preferNoRspCheckbox.checked = initialState.preferWriteWithoutResponse;
    this.preferNoRspLabelSpan = createEl("span", { text: c.optPreferWriteWithoutResponse });
    this.preferNoRspCheckbox.addEventListener("change", () => {
      handlers.onToggleWriteWithoutResponse(this.preferNoRspCheckbox.checked);
    });

    const devIconBox = createEl(
      "span",
      { className: "pastel-tile-icon pastel-badge-icon", attrs: { "data-pastel": "mint" } },
      [createStudioIcon("sliders", 18)]
    );
    // 意図: accordion ガイドに従い、summary 内には見出しタグを置かず span のみにし、記号もラベル直後に配置する。
    this.devSummaryTitleEl = createEl("span", {
      className: "func-row-title-inline",
      text: d.sectionDeveloper,
    });
    const devChevron = createEl(
      "span",
      { className: "func-chevron", attrs: { "aria-hidden": "true" } },
      [createStudioIcon("chevronRight", 16)]
    );
    const devSummaryEl = createEl("summary", { className: "func-row-summary" }, [
      devIconBox,
      createEl("span", { className: "func-summary-label-group" }, [
        this.devSummaryTitleEl,
        devChevron,
      ]),
    ]);
    const devBodyEl = createEl("div", { className: "func-row-body" }, [
      createEl("div", { className: "option-list" }, [
        createEl("label", { className: "check-row", attrs: { for: "detail-opt-accept-all" } }, [
          this.acceptAllCheckbox,
          this.acceptAllLabelSpan,
        ]),
        createEl("label", { className: "check-row", attrs: { for: "detail-opt-write-no-rsp" } }, [
          this.preferNoRspCheckbox,
          this.preferNoRspLabelSpan,
        ]),
      ]),
      logPanelEl,
    ]);
    const developerDetailsEl = createEl("details", { className: "func-row" }, [
      devSummaryEl,
      devBodyEl,
    ]);

    this.element = createEl(
      "div",
      { className: "detail-screen-stack", attrs: { "aria-label": d.screenTitle } },
      [
        topBarEl,
        this.emptyNoticeCard,
        this.statusCardEl,
        this.specsCardEl,
        unpairCardEl,
        developerDetailsEl,
      ]
    );
    this.render(initialState);
  }

  /**
   * Clears any ephemeral forget-result alert cleanly before opening Detail for another badge.
   */
  public clearTransientFeedback(): void {
    this.forgetFeedbackMessage = null;
    this.isEditingNickname = false;
    this.renderForgetNotice();
    this.syncRenameVisibility();
  }

  /**
   * Applies newly activated translations cleanly across all labels and sections.
   *
   * @param nextDict - Newly activated locale dictionary.
   * @param state - Latest store state snapshot.
   */
  public updateLocale(nextDict: TranslationSchema, state: AppStateSnapshot): void {
    this.dict = nextDict;
    const d = nextDict.detail;
    const c = nextDict.connection;

    this.element.setAttribute("aria-label", d.screenTitle);
    this.backBtn.setAttribute("aria-label", nextDict.header.btnBack);
    this.topBarTitleEl.textContent = d.screenTitle;
    this.emptyTitleEl.textContent = d.noDeviceSelectedTitle;
    this.emptyHintEl.textContent = d.noDeviceSelectedHint;
    this.emptyConnectBtn.labelEl.textContent = nextDict.home.btnConnectNew;

    this.statusSectionHeadingEl.textContent = d.sectionStatus;
    this.renameToggleBtn.setAttribute("aria-label", c.btnRenameDevice);
    this.renameInputEl.setAttribute("placeholder", c.renamePlaceholder);
    this.renameSaveBtn.labelEl.textContent = c.btnSaveNickname;
    this.renameCancelBtn.labelEl.textContent = c.btnCancelRename;
    this.sendWithDeviceBtn.labelEl.textContent = d.btnSendWithThisDevice;
    this.disconnectBtn.labelEl.textContent = c.btnDisconnect;
    this.autoRetryLabelSpan.textContent = c.optAutoRetryOnDrop;
    this.autoStartupLabelSpan.textContent = c.optAutoConnectOnStartup;

    this.specsSectionHeadingEl.textContent = d.sectionSpecs;
    this.cachedInfoPillEl.textContent = d.cachedInfoBadge;
    this.refreshBtn.labelEl.textContent = c.btnRefreshTelemetry;
    this.specBatteryRow.labelEl.textContent = c.labelBattery;
    this.specFwHwRow.labelEl.textContent = c.labelFirmwareHardware;
    this.specDisplayRow.labelEl.textContent = c.labelDisplaySpec;
    this.specStorageRow.labelEl.textContent = c.labelFreeStorage;
    this.specModelRow.labelEl.textContent = c.labelModelInfo;

    this.unpairSectionHeadingEl.textContent = d.sectionUnpair;
    this.unpairIntroEl.textContent = d.unpairIntro;
    this.unpairStep1TitleEl.textContent = d.unpairStep1Title;
    this.unpairStep1BodyEl.textContent = d.unpairStep1Body;
    this.forgetBtn.labelEl.textContent = d.btnForgetThisBadge;
    this.unpairStep2TitleEl.textContent = d.unpairStep2Title;
    this.unpairStep2BodyEl.textContent = d.unpairStep2Body;
    this.chromeUrlCodeEl.textContent = d.unpairChromeUrl;
    this.copyChromeUrlBtn.labelEl.textContent = d.btnCopyChromeUrl;
    this.unpairStep3TitleEl.textContent = d.unpairStep3Title;
    this.osWindowsEl.textContent = d.unpairStep3Windows;
    this.osAndroidEl.textContent = d.unpairStep3Android;
    this.osAppleEl.textContent = d.unpairStep3Apple;

    this.devSummaryTitleEl.textContent = d.sectionDeveloper;
    this.acceptAllLabelSpan.textContent = c.optAcceptAllDevices;
    this.preferNoRspLabelSpan.textContent = c.optPreferWriteWithoutResponse;

    this.render(state);
  }

  /**
   * Synchronizes visible device info, live/cached hardware specs, and control states.
   *
   * @param state - Latest immutable store snapshot.
   */
  public render(state: AppStateSnapshot): void {
    this.lastState = state;
    const profile = this.resolveTargetProfile(state);
    const c = this.dict.connection;
    const d = this.dict.detail;

    const isBusy =
      state.connectionStatus === "connecting" ||
      state.connectionStatus === "uploading" ||
      state.connectionStatus === "reconnecting";
    const isLinked =
      state.connectionStatus === "connected" || state.connectionStatus === "uploading";

    this.acceptAllCheckbox.checked = state.acceptAllDevices;
    this.acceptAllCheckbox.disabled = isLinked || isBusy;
    this.preferNoRspCheckbox.checked = state.preferWriteWithoutResponse;
    this.autoRetryCheckbox.checked = state.reconnectPrefs.autoRetryOnDrop;
    this.autoStartupCheckbox.checked = state.reconnectPrefs.autoConnectOnStartup;

    this.emptyNoticeCard.hidden = profile !== null;
    this.statusCardEl.hidden = profile === null;
    this.specsCardEl.hidden = profile === null;
    this.forgetBtn.button.disabled = profile === null || isBusy;

    if (!profile) {
      return;
    }

    const isConnectedHere = isLinked && state.activeDeviceId === profile.id;
    const hasLiveHandle = state.liveDeviceIds.includes(profile.id);
    const liveMeta = isConnectedHere ? state.metadata : null;

    this.deviceNameDisplayEl.textContent = profile.nickname;
    this.syncRenameVisibility();

    this.statusPillEl.textContent = isConnectedHere ? c.statusConnected : c.statusDisconnected;
    this.statusPillEl.setAttribute("data-tone", isConnectedHere ? "ok" : "warn");

    const batteryPct = liveMeta?.standardInfo?.batteryPercent ?? profile.lastBatteryPercent;
    if (batteryPct !== null && batteryPct !== undefined) {
      const lowSuffix = batteryPct < 20 ? ` · ${c.batteryLowWarning}` : "";
      this.batteryPillEl.textContent = `${c.labelBattery}: ${batteryPct}%${lowSuffix}`;
      this.batteryPillEl.setAttribute("data-tone", batteryPct < 20 ? "warn" : "ok");
    } else {
      this.batteryPillEl.textContent = `${c.labelBattery}: ${c.valueNotRead}`;
      this.batteryPillEl.removeAttribute("data-tone");
    }

    if (profile.lastConnectedAtMs) {
      const formattedTime = new Date(profile.lastConnectedAtMs).toLocaleString();
      this.lastSyncedEl.textContent = `${d.lastSyncedLabel}: ${formattedTime}`;
    } else {
      this.lastSyncedEl.textContent = `${d.lastSyncedLabel}: ${d.lastSyncedNever}`;
    }

    this.sendWithDeviceBtn.button.disabled = isBusy;
    this.connectBtn.button.hidden = isConnectedHere;
    this.connectBtn.button.disabled = isBusy;
    this.connectBtn.labelEl.textContent = hasLiveHandle ? c.btnReconnect : c.btnConnect;
    this.disconnectBtn.button.hidden = !isConnectedHere;
    this.disconnectBtn.button.disabled = !isConnectedHere || state.connectionStatus === "uploading";

    // Specs Card (live if connected here, otherwise cached profile snapshot)
    this.cachedInfoPillEl.hidden = isConnectedHere;
    this.refreshBtn.button.disabled = !isConnectedHere || isBusy;

    this.specBatteryRow.valueEl.textContent =
      batteryPct !== null && batteryPct !== undefined ? `${batteryPct}%` : c.valueNotRead;

    const fw = liveMeta?.standardInfo?.firmwareRevision || profile.lastFirmwareRevision || "";
    const hw = liveMeta?.standardInfo?.hardwareRevision || "";
    this.specFwHwRow.valueEl.textContent =
      fw || hw ? `${fw || "-"} / ${hw || "-"}` : c.valueNotRead;

    const dial = liveMeta?.dialInfo;
    this.specDisplayRow.valueEl.textContent = dial
      ? `${dial.width}×${dial.height} (${dial.shape}), ${dial.algorithmName}`
      : profile.lastDisplaySpec || c.valueNotRead;

    const freeBytes = liveMeta?.freeStorageBytes ?? profile.lastFreeStorageBytes ?? null;
    if (freeBytes !== null && freeBytes !== undefined) {
      const kib = (freeBytes / 1024).toFixed(1);
      this.specStorageRow.valueEl.textContent = `${freeBytes.toLocaleString()} B (${kib} KB)`;
    } else if (liveMeta?.freeStorageError) {
      this.specStorageRow.valueEl.textContent = c.freeStorageTimedOut;
    } else {
      this.specStorageRow.valueEl.textContent = c.valueNotRead;
    }

    const modelParts = [
      dial ? `${dial.mainModel}/${dial.mchModel}` : null,
      dial?.customer || null,
      liveMeta?.standardInfo?.manufacturer || profile.advertisedName || null,
    ].filter((v): v is string => Boolean(v));
    this.specModelRow.valueEl.textContent =
      modelParts.length > 0 ? modelParts.join(" · ") : c.valueNotRead;
  }

  /**
   * Resolves the inspected saved badge profile based on `detailDeviceId` or `activeDeviceId`.
   *
   * @param state - Latest store snapshot, or `null`.
   * @returns Matching {@link SavedBadgeProfile} or `null` when none saved.
   */
  private resolveTargetProfile(state: AppStateSnapshot | null): SavedBadgeProfile | null {
    if (!state || state.savedDevices.length === 0) {
      return null;
    }
    if (state.detailDeviceId) {
      const found = state.savedDevices.find((d) => d.id === state.detailDeviceId);
      if (found) {
        return found;
      }
    }
    if (state.activeDeviceId) {
      const active = state.savedDevices.find((d) => d.id === state.activeDeviceId);
      if (active) {
        return active;
      }
    }
    return state.savedDevices[0] ?? null;
  }

  /**
   * Toggles inline nickname edit visibility cleanly without rebuilding card DOM.
   */
  private syncRenameVisibility(): void {
    this.deviceNameDisplayEl.hidden = this.isEditingNickname;
    this.renameToggleBtn.hidden = this.isEditingNickname;
    this.renameFormEl.hidden = !this.isEditingNickname;
  }

  /**
   * Renders transient feedback message after forgetting a badge cleanly inside Step 1.
   */
  private renderForgetNotice(): void {
    if (!this.forgetFeedbackMessage) {
      this.forgetNoticeEl.hidden = true;
      return;
    }
    this.forgetNoticeEl.textContent = this.forgetFeedbackMessage.text;
    this.forgetNoticeEl.setAttribute("data-tone", this.forgetFeedbackMessage.tone);
    this.forgetNoticeEl.hidden = false;
  }
}
