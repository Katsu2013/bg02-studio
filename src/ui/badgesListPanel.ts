/**
 * @module ui/badgesListPanel
 * Screen 4 (`activeScreen === "badges"`): My Badges switcher listing saved BG02 badges
 * with honest live vs. prior-session battery readouts and clean drill-down to Details.
 */

import { interpolate } from "../i18n/i18n";
import type { TranslationSchema } from "../i18n/types";
import type { AppStateSnapshot } from "../state/appStore";
import { resolveBadgeStatusSummary } from "./badgeStatusHelper";
import { createButton, createEl, createIconButton, replaceChildrenSafe, type IconButtonHandle } from "./domHelpers";
import { createStudioIcon } from "./icons";

/** Callbacks invoked by Screen 4 (`"badges"`) interactions. */
export interface BadgesListHandlers {
  /** Returns cleanly to the originating screen (`"home"` or `"send"`). */
  readonly onBack: () => void;
  /** Opens Web Bluetooth picker to pair and register a new BG02 badge. */
  readonly onAddBadge: () => void;
  /** Retries connecting to the badge whose add/pair handshake failed. */
  readonly onRetryConnect: () => void;
  /** Reopens the Web Bluetooth picker after a failed pairing/connection attempt. */
  readonly onReselectBluetooth: () => void;
  /** Opens Screen 5 (`"device-detail"`) for the tapped badge ID without losing draft edits. */
  readonly onOpenDetail: (deviceId: string) => void;
}

/**
 * Renders Screen 4 (`"badges"`): Saved badges list + Add Badge flow.
 */
export class BadgesListPanel {
  /** Root container for Screen 4. */
  public readonly element: HTMLElement;
  /** Explicit Back button exposed for accessible focus placement. */
  public readonly backBtn: HTMLButtonElement;

  /** Active localization schema. */
  private dict: TranslationSchema;
  /** Screen navigation and pairing callbacks. */
  private readonly handlers: BadgesListHandlers;

  /** Context-aware back button label span. */
  private readonly backBtnLabelEl: HTMLSpanElement;
  /** Top navigation bar screen heading. */
  private readonly topTitleEl: HTMLHeadingElement;
  /** Empty-state instruction card shown when no badges are saved. */
  private readonly emptyCardEl: HTMLDivElement;
  /** Empty-state guidance paragraph element. */
  private readonly emptyGuideEl: HTMLParagraphElement;
  /** Container holding rendered saved badge cards. */
  private readonly listWrapEl: HTMLDivElement;
  /** Inline alert displaying add-badge connection failure reasons and recovery actions. */
  private readonly connectAlertEl: HTMLDivElement;
  /** Connect failure alert headline paragraph. */
  private readonly connectAlertTitleEl: HTMLParagraphElement;
  /** Connect failure alert explanation body paragraph. */
  private readonly connectAlertBodyEl: HTMLParagraphElement;
  /** Retry connection button inside the add-badge failure alert. */
  private readonly connectRetryBtn: HTMLButtonElement;
  /** Re-open Bluetooth chooser button inside the add-badge failure alert. */
  private readonly connectReselectBtn: HTMLButtonElement;
  /** Concise pre-pairing step hint above the Add Badge button. */
  private readonly stepHintEl: HTMLParagraphElement;
  /** Primary button opening Web Bluetooth chooser to pair a badge. */
  private readonly addBadgeBtn: IconButtonHandle;

  /**
   * Builds Screen 4 DOM nodes and wires button handlers.
   *
   * @param initialDict - Active translation schema.
   * @param handlers - Navigation and pairing callbacks.
   */
  public constructor(initialDict: TranslationSchema, handlers: BadgesListHandlers) {
    this.dict = initialDict;
    this.handlers = handlers;

    this.backBtnLabelEl = createEl("span", { text: initialDict.badges.btnBackHome });
    this.backBtn = createEl("button", { className: "screen-back-btn" }, [
      createStudioIcon("arrowLeft", 18),
      this.backBtnLabelEl,
    ]);
    this.backBtn.type = "button";
    this.backBtn.addEventListener("click", handlers.onBack);

    this.topTitleEl = createEl("h1", {
      className: "screen-top-title",
      text: initialDict.badges.screenTitle,
    });
    const topBar = createEl("div", { className: "screen-top-bar" }, [
      this.backBtn,
      this.topTitleEl,
      createEl("span", { className: "screen-top-spacer", attrs: { "aria-hidden": "true" } }),
    ]);

    this.emptyGuideEl = createEl("p", {
      className: "badges-empty-text",
      text: initialDict.badges.emptyGuide,
    });
    this.emptyCardEl = createEl("div", { className: "surface-card badges-empty-card" }, [
      this.emptyGuideEl,
    ]);

    this.listWrapEl = createEl("div", { className: "badges-card-list" });

    this.connectAlertTitleEl = createEl("p", { className: "detail-connect-alert-title", text: "" });
    this.connectAlertBodyEl = createEl("p", { className: "detail-connect-alert-body", text: "" });
    this.connectRetryBtn = createButton("btn btn-sm btn-secondary", initialDict.badges.btnRetryAdd);
    this.connectReselectBtn = createButton(
      "btn btn-sm btn-secondary",
      initialDict.send.btnReselectBluetooth
    );
    this.connectRetryBtn.addEventListener("click", handlers.onRetryConnect);
    this.connectReselectBtn.addEventListener("click", handlers.onReselectBluetooth);
    this.connectAlertEl = createEl(
      "div",
      {
        className: "inline-alert badges-connect-alert",
        attrs: { role: "alert", "data-tone": "err" },
      },
      [
        createStudioIcon("alert", 18),
        createEl("div", { className: "detail-connect-alert-copy" }, [
          this.connectAlertTitleEl,
          this.connectAlertBodyEl,
          createEl("div", { className: "badges-connect-recovery-row" }, [
            this.connectRetryBtn,
            this.connectReselectBtn,
          ]),
        ]),
      ]
    );
    this.connectAlertEl.hidden = true;

    this.stepHintEl = createEl("p", {
      className: "badges-step-hint",
      text: initialDict.badges.firstConnectStepHint,
    });

    this.addBadgeBtn = createIconButton(
      "btn btn-primary btn-cta-large",
      "plus",
      initialDict.badges.btnAddBadge,
      18
    );
    this.addBadgeBtn.button.addEventListener("click", handlers.onAddBadge);

    this.element = createEl(
      "section",
      {
        id: "screen-badges",
        className: "screen-view badges-screen",
        attrs: { "aria-label": initialDict.badges.screenTitle },
      },
      [
        topBar,
        this.emptyCardEl,
        this.listWrapEl,
        this.connectAlertEl,
        this.stepHintEl,
        this.addBadgeBtn.button,
      ]
    );
  }

  /**
   * Synchronizes localized strings across Screen 4 and re-renders.
   *
   * @param nextDict - Updated translation schema.
   * @param state - Latest store snapshot.
   * @param webBluetoothAvailable - Whether Web Bluetooth is exposed by runtime.
   */
  public updateLocale(
    nextDict: TranslationSchema,
    state: AppStateSnapshot,
    webBluetoothAvailable: boolean
  ): void {
    this.dict = nextDict;
    const b = nextDict.badges;
    this.element.setAttribute("aria-label", b.screenTitle);
    this.topTitleEl.textContent = b.screenTitle;
    this.emptyGuideEl.textContent = b.emptyGuide;
    this.stepHintEl.textContent = b.firstConnectStepHint;
    this.connectRetryBtn.textContent = b.btnRetryAdd;
    this.connectReselectBtn.textContent = nextDict.send.btnReselectBluetooth;
    this.addBadgeBtn.labelEl.textContent = b.btnAddBadge;
    this.render(state, webBluetoothAvailable);
  }

  /**
   * Renders saved badge cards with live vs. prior-session battery distinction.
   *
   * @param state - Latest store snapshot.
   * @param webBluetoothAvailable - Disables add button when Web Bluetooth is unavailable.
   */
  public render(state: AppStateSnapshot, webBluetoothAvailable: boolean): void {
    const b = this.dict.badges;
    const isConnecting = state.connectionStatus === "connecting";
    const isUploading = Boolean(state.uploadProgress);
    this.backBtnLabelEl.textContent =
      state.badgesReturnScreen === "send" ? b.btnBackSend : b.btnBackHome;
    this.addBadgeBtn.labelEl.textContent = isConnecting ? b.statusConnecting : b.btnAddBadge;
    this.addBadgeBtn.button.disabled = !webBluetoothAvailable || isConnecting || isUploading;

    if (!isConnecting && state.sendOutcome?.kind === "connect_failed") {
      const o = state.sendOutcome;
      const reason = o.connectFailureReason;
      this.connectAlertEl.hidden = false;
      this.connectAlertTitleEl.textContent = interpolate(this.dict.send.stateConnectFailedTitle, {
        name: o.targetDeviceName || "BG02",
      });
      this.connectAlertBodyEl.textContent =
        reason === "permission_unavailable"
          ? this.dict.send.connectPermissionUnavailableBody
          : this.dict.send.connectGattFailedBody;
      this.connectRetryBtn.hidden = reason === "permission_unavailable";
      this.connectRetryBtn.disabled = !webBluetoothAvailable || isUploading;
      this.connectReselectBtn.disabled = !webBluetoothAvailable || isUploading;
    } else {
      this.connectAlertEl.hidden = true;
    }

    const devices = state.savedDevices;
    this.emptyCardEl.hidden = devices.length > 0;
    this.listWrapEl.hidden = devices.length === 0;

    if (devices.length === 0) {
      replaceChildrenSafe(this.listWrapEl, []);
      return;
    }

    const cards: HTMLElement[] = [];
    for (const profile of devices) {
      const summary = resolveBadgeStatusSummary(profile, state, this.dict);
      const avatar = createEl(
        "span",
        { className: "badge-list-avatar", attrs: { "aria-hidden": "true" } },
        [createStudioIcon("badge", 22)]
      );
      const nameEl = createEl("span", {
        className: "badge-list-name",
        text: profile.nickname,
      });
      const statusPill = createEl("span", {
        className: "mini-pill",
        text: summary.statusLabel,
        attrs: summary.tone ? { "data-tone": summary.tone } : undefined,
      });

      const batteryChildren: Node[] = [
        createStudioIcon("battery", 14),
        createEl("span", { text: summary.batteryText }),
      ];
      if (summary.isLowBattery) {
        batteryChildren.push(
          createEl("span", {
            className: "badge-low-battery-tag",
            text: ` (${b.batteryLowHint})`,
          })
        );
      }
      const batteryLine = createEl("span", { className: "badge-list-battery" }, batteryChildren);

      const metaRow = createEl("span", { className: "badge-list-meta" }, [
        statusPill,
        batteryLine,
      ]);
      const manage = createEl("span", {
        className: "badge-list-manage",
        text: this.dict.home.btnManage,
        attrs: { "aria-hidden": "true" },
      });

      const btn = createEl("button", { className: "badge-list-card surface-card" }, [
        avatar,
        createEl("span", { className: "badge-list-main" }, [nameEl, metaRow]),
        manage,
      ]);
      btn.type = "button";
      btn.setAttribute("aria-label", interpolate(this.dict.home.manageNamed, { name: profile.nickname }));
      btn.addEventListener("click", () => this.handlers.onOpenDetail(profile.id));
      cards.push(btn);
    }

    replaceChildrenSafe(this.listWrapEl, cards);
  }
}
