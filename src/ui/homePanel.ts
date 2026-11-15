/**
 * @module ui/homePanel
 * Screen 1 (`activeScreen === "home"`): Beginner-friendly Home view listing registered
 * BG02 badges with essential status & battery info, one-tap Connect & Push actions,
 * offline image trial entry, and navigation to Device Details / Bluetooth Unpair instructions.
 */

import { interpolate } from "../i18n/i18n";
import type { TranslationSchema } from "../i18n/types";
import type { AppStateSnapshot } from "../state/appStore";
import { DEVICE_ACCENT_PALETTE, type SavedBadgeProfile } from "../state/deviceRegistry";
import { createButton, createEl, createIconButton, type IconButtonHandle } from "./domHelpers";
import { createStudioIcon, type StudioIconName } from "./icons";

/** Callbacks dispatched by {@link HomePanel} user interactions. */
export interface HomePanelHandlers {
  /** Opens the Web Bluetooth picker to pair/connect a new or unplugged BG02 badge. */
  readonly onAddOrConnectDevice: () => void;
  /** Connects (if needed) to the tapped badge card and enters Screen 2 (`"push"`). */
  readonly onSelectBadgeAndPush: (deviceId: string) => void;
  /** Opens Screen 3 (`"device-detail"`) for a specific badge or general unpair instructions. */
  readonly onOpenDeviceDetail: (deviceId: string | null) => void;
  /** Disconnects the active GATT session cleanly. */
  readonly onDisconnect: () => void;
  /** Aborts an in-flight automatic reconnect loop. */
  readonly onCancelAutoReconnect: () => void;
  /** Enters Screen 2 (`"push"`) in offline composition mode without waiting for Bluetooth. */
  readonly onOpenOfflinePush: () => void;
}

/**
 * Constructs a small decorative circular mini-badge avatar mirroring physical BG02 dials cleanly via SVG.
 *
 * @returns Styled circular avatar `<span>` element.
 */
function createMiniDialAvatar(): HTMLSpanElement {
  return createEl(
    "span",
    { className: "badge-card-avatar", attrs: { "aria-hidden": "true" } },
    [createStudioIcon("badge", 28)]
  );
}

/** Handle exposing a SuperBand-style Home action row and its localized text nodes. */
export interface HomeActionRowHandle {
  /** Native `<button type="button">` row container. */
  readonly button: HTMLButtonElement;
  /** Primary row title label updated on locale switches. */
  readonly titleEl: HTMLSpanElement;
  /** Concise secondary helper subtitle updated on locale switches. */
  readonly descEl: HTMLSpanElement;
}

/**
 * Builds a SuperBand-style white action row opening secondary Home views (`offline push`, `unpair guide`).
 *
 * @param iconName - Vector icon name rendered inside the pastel icon square.
 * @param pastel - Soft pastel tint identifier (`"violet" | "amber" | "mint" | "blue"`).
 * @param initialTitle - Initial primary row title text.
 * @param initialDesc - Initial secondary description text.
 * @param onClick - Click handler invoked on activation.
 * @returns Handle containing the row button and mutable title/description nodes.
 */
function createHomeActionRow(
  iconName: StudioIconName,
  pastel: "violet" | "amber" | "mint" | "blue",
  initialTitle: string,
  initialDesc: string,
  onClick: () => void
): HomeActionRowHandle {
  const iconBox = createEl(
    "span",
    { className: "pastel-tile-icon pastel-badge-icon", attrs: { "data-pastel": pastel } },
    [createStudioIcon(iconName, 18)]
  );
  const titleEl = createEl("span", { className: "home-row-title", text: initialTitle });
  const descEl = createEl("span", { className: "home-row-desc", text: initialDesc });
  const chevron = createEl("span", { className: "func-chevron", attrs: { "aria-hidden": "true" } }, [
    createStudioIcon("chevronRight", 18),
  ]);

  const button = createEl("button", { className: "home-action-row" }, [
    iconBox,
    createEl("span", { className: "home-row-text" }, [titleEl, descEl]),
    chevron,
  ]);
  button.type = "button";
  button.addEventListener("click", onClick);
  return { button, titleEl, descEl };
}

/**
 * Renders Screen 1 (Home / Device List) separating onboarding, multi-badge cards,
 * offline preview access, and Device Details / Bluetooth Unpair instructions.
 */
export class HomePanel {
  /** Root DOM container for the Home screen. */
  public readonly element: HTMLElement;

  /** Active translation dictionary reference. */
  private dict: TranslationSchema;
  /** Interaction handler callbacks. */
  private readonly handlers: HomePanelHandlers;
  /** Accessible screen heading (`<h2>`). */
  private readonly screenHeadingEl: HTMLHeadingElement;
  /** First-run onboarding card shown when no badges have been paired yet. */
  private readonly emptyWelcomeCard: HTMLElement;
  /** Welcome card title element. */
  private readonly welcomeTitleEl: HTMLHeadingElement;
  /** Welcome card lead tagline element. */
  private readonly welcomeLeadEl: HTMLParagraphElement;
  /** Ordered onboarding list step elements (`1..3`). */
  private readonly welcomeStepEls: ReadonlyArray<HTMLLIElement>;
  /** Welcome card primary Connect button. */
  private readonly welcomeConnectBtn: IconButtonHandle;
  /** Live reconnection progress notice banner shown while retrying after a drop. */
  private readonly reconnectBannerEl: HTMLDivElement;
  /** Live reconnection status text node. */
  private readonly reconnectBannerTextEl: HTMLSpanElement;
  /** Button aborting active automatic reconnection retries. */
  private readonly cancelReconnectBtn: HTMLButtonElement;
  /** Wrapper section containing registered badge cards (`display: none` when empty). */
  private readonly devicesSectionEl: HTMLElement;
  /** Registered badges section heading (`<h3>`). */
  private readonly devicesHeadingEl: HTMLHeadingElement;
  /** Dynamic badge card list mount container. */
  private readonly badgeCardListEl: HTMLDivElement;
  /** Button adding a second or replacement BG02 badge when devices are already saved. */
  private readonly addDeviceBtn: IconButtonHandle;
  /** Helper tools & guide section heading (`<h3>`). */
  private readonly moreHeadingEl: HTMLHeadingElement;
  /** White action row entering Screen 2 (`"push"`) in offline composition mode. */
  private readonly offlinePushRow: HomeActionRowHandle;
  /** White action row opening Screen 3 (`"device-detail"`) & Bluetooth Unpair instructions. */
  private readonly unpairGuideRow: HomeActionRowHandle;
  /** Concise beginner note stating >= 20% battery and unplugged charger rule. */
  private readonly batteryRuleFooterEl: HTMLParagraphElement;
  /** Signature memo preventing needless card DOM recreation while hovering or tapping buttons. */
  private lastCardsSignature = "";

  /**
   * Builds the beginner-first Home screen layout cleanly via safe DOM helpers.
   *
   * @param initialDict - Active localization dictionary.
   * @param handlers - User action callbacks.
   */
  public constructor(initialDict: TranslationSchema, handlers: HomePanelHandlers) {
    this.dict = initialDict;
    this.handlers = handlers;
    const h = initialDict.home;

    this.screenHeadingEl = createEl("h2", {
      className: "sr-only",
      text: h.screenHeading,
    });

    // 1. Reconnect banner (hidden unless auto-retry loop runs on Home)
    this.reconnectBannerTextEl = createEl("span");
    this.cancelReconnectBtn = createButton(
      "btn btn-sm",
      initialDict.connection.btnCancelReconnect
    );
    this.cancelReconnectBtn.addEventListener("click", () => handlers.onCancelAutoReconnect());
    this.reconnectBannerEl = createEl(
      "div",
      { className: "reconnect-banner", attrs: { hidden: "", role: "status" } },
      [this.reconnectBannerTextEl, this.cancelReconnectBtn]
    );

    // 2. Onboarding Empty Welcome Hero
    this.welcomeTitleEl = createEl("h3", {
      className: "welcome-hero-title",
      text: h.welcomeTitle,
    });
    this.welcomeLeadEl = createEl("p", {
      className: "welcome-hero-lead",
      text: h.welcomeLead,
    });
    const step1 = createEl("li", { text: h.welcomeStep1 });
    const step2 = createEl("li", { text: h.welcomeStep2 });
    const step3 = createEl("li", { text: h.welcomeStep3 });
    this.welcomeStepEls = [step1, step2, step3];

    this.welcomeConnectBtn = createIconButton("btn btn-hero-white", "bluetooth", h.btnConnectNew, 16);
    this.welcomeConnectBtn.button.addEventListener("click", () => handlers.onAddOrConnectDevice());

    this.emptyWelcomeCard = createEl("section", { className: "hero-welcome-card" }, [
      createEl("div", { className: "welcome-hero-top" }, [
        createMiniDialAvatar(),
        createEl("div", { className: "welcome-hero-copy" }, [
          this.welcomeTitleEl,
          this.welcomeLeadEl,
        ]),
      ]),
      createEl("ol", { className: "welcome-steps-list" }, [step1, step2, step3]),
      this.welcomeConnectBtn.button,
    ]);

    // 3. Registered Badge Cards Section
    this.devicesHeadingEl = createEl("h3", {
      className: "func-section-heading",
      text: h.sectionDevices,
    });
    this.badgeCardListEl = createEl("div", { className: "home-device-list" });
    this.addDeviceBtn = createIconButton("btn btn-add-outline", "plus", h.btnConnectNew, 15);
    this.addDeviceBtn.button.addEventListener("click", () => handlers.onAddOrConnectDevice());

    this.devicesSectionEl = createEl("section", { className: "home-devices-section" }, [
      this.devicesHeadingEl,
      this.badgeCardListEl,
      this.addDeviceBtn.button,
    ]);

    // 4. More / Offline Editor & Unpair Guide Section
    this.moreHeadingEl = createEl("h3", {
      className: "func-section-heading",
      text: h.sectionMoreActions,
    });
    this.offlinePushRow = createHomeActionRow(
      "photo",
      "violet",
      h.btnOpenOfflineEditor,
      h.btnOpenOfflineEditorDesc,
      () => handlers.onOpenOfflinePush()
    );
    this.unpairGuideRow = createHomeActionRow(
      "unlink",
      "amber",
      h.btnOpenUnpairGuide,
      h.btnOpenUnpairGuideDesc,
      () => handlers.onOpenDeviceDetail(null)
    );

    const moreList = createEl("div", { className: "home-more-list" }, [
      this.offlinePushRow.button,
      this.unpairGuideRow.button,
    ]);

    this.batteryRuleFooterEl = createEl("p", {
      className: "hint-caption home-rule-note",
      text: h.batteryRuleFooter,
    });

    this.element = createEl(
      "div",
      { className: "home-screen-stack", attrs: { "aria-label": h.screenHeading } },
      [
        this.screenHeadingEl,
        this.reconnectBannerEl,
        this.emptyWelcomeCard,
        this.devicesSectionEl,
        this.moreHeadingEl,
        moreList,
        this.batteryRuleFooterEl,
      ]
    );
  }

  /**
   * Applies newly activated translations to static controls and rebuilds badge cards cleanly.
   *
   * @param nextDict - Updated locale dictionary.
   * @param state - Latest store state snapshot.
   */
  public updateLocale(nextDict: TranslationSchema, state: AppStateSnapshot): void {
    this.dict = nextDict;
    const h = nextDict.home;
    this.screenHeadingEl.textContent = h.screenHeading;
    this.element.setAttribute("aria-label", h.screenHeading);
    this.welcomeTitleEl.textContent = h.welcomeTitle;
    this.welcomeLeadEl.textContent = h.welcomeLead;
    this.welcomeStepEls[0].textContent = h.welcomeStep1;
    this.welcomeStepEls[1].textContent = h.welcomeStep2;
    this.welcomeStepEls[2].textContent = h.welcomeStep3;
    this.welcomeConnectBtn.labelEl.textContent = h.btnConnectNew;
    this.cancelReconnectBtn.textContent = nextDict.connection.btnCancelReconnect;
    this.devicesHeadingEl.textContent = h.sectionDevices;
    this.addDeviceBtn.labelEl.textContent = h.btnConnectNew;
    this.moreHeadingEl.textContent = h.sectionMoreActions;
    this.offlinePushRow.titleEl.textContent = h.btnOpenOfflineEditor;
    this.offlinePushRow.descEl.textContent = h.btnOpenOfflineEditorDesc;
    this.unpairGuideRow.titleEl.textContent = h.btnOpenUnpairGuide;
    this.unpairGuideRow.descEl.textContent = h.btnOpenUnpairGuideDesc;
    this.batteryRuleFooterEl.textContent = h.batteryRuleFooter;

    this.lastCardsSignature = "";
    this.render(state);
  }

  /**
   * Synchronizes registered device cards, empty onboarding state, and active reconnect banner.
   *
   * @param state - Latest immutable store snapshot.
   */
  public render(state: AppStateSnapshot): void {
    const isBusy =
      state.connectionStatus === "connecting" ||
      state.connectionStatus === "uploading" ||
      state.connectionStatus === "reconnecting";
    const isLinked =
      state.connectionStatus === "connected" || state.connectionStatus === "uploading";

    this.welcomeConnectBtn.button.disabled = isBusy;
    this.addDeviceBtn.button.disabled = isBusy;

    if (state.connectionStatus === "reconnecting" && state.reconnectStatus) {
      const targetProfile = state.savedDevices.find(
        (d) => d.id === state.reconnectStatus?.targetDeviceId
      );
      this.reconnectBannerTextEl.textContent = interpolate(
        this.dict.connection.reconnectingNotice,
        {
          name: targetProfile?.nickname || "BG02",
          attempt: state.reconnectStatus.attempt,
          max: state.reconnectStatus.maxAttempts,
        }
      );
      this.reconnectBannerEl.hidden = false;
    } else {
      this.reconnectBannerEl.hidden = true;
    }

    const hasDevices = state.savedDevices.length > 0;
    this.emptyWelcomeCard.hidden = hasDevices;
    this.devicesSectionEl.hidden = !hasDevices;

    if (!hasDevices) {
      this.lastCardsSignature = "";
      this.badgeCardListEl.replaceChildren();
      return;
    }

    // Check only essential fields for the card list signature so animations stay smooth
    const liveBattery = state.metadata?.standardInfo?.batteryPercent;
    const signature = JSON.stringify({
      devices: state.savedDevices.map((d) => ({
        id: d.id,
        nickname: d.nickname,
        accentHex: d.accentHex,
        bat: d.lastBatteryPercent,
      })),
      liveIds: state.liveDeviceIds,
      activeId: state.activeDeviceId,
      status: state.connectionStatus,
      liveBattery,
      locale: this.dict.home.screenHeading,
    });
    if (signature === this.lastCardsSignature) {
      return;
    }
    this.lastCardsSignature = signature;

    const cards = state.savedDevices.map((profile, idx) =>
      this.buildBadgeCard(profile, idx, state, isBusy, isLinked)
    );
    this.badgeCardListEl.replaceChildren(...cards);
  }

  /**
   * Builds a minimalist Home card displaying badge identity, connection status, battery %,
   * primary Send action, and quick Details/Unpair button.
   *
   * @param profile - Saved badge metadata profile.
   * @param index - Zero-based display order (`0` rendered as featured gradient hero card when active).
   * @param state - Latest store state snapshot.
   * @param isBusy - `true` while connecting, reconnecting, or uploading.
   * @param isLinked - `true` when any GATT link is active.
   * @returns Constructed card `<article>` element.
   */
  private buildBadgeCard(
    profile: SavedBadgeProfile,
    index: number,
    state: AppStateSnapshot,
    isBusy: boolean,
    isLinked: boolean
  ): HTMLElement {
    const h = this.dict.home;
    const c = this.dict.connection;
    const isActive = profile.id === state.activeDeviceId;
    const isConnectedHere = isActive && isLinked;
    const isConnectingHere =
      isActive &&
      (state.connectionStatus === "connecting" || state.connectionStatus === "reconnecting");
    const isPrimaryHero = isConnectedHere || (state.activeDeviceId === null && index === 0) || isActive;

    const batteryPercent =
      isConnectedHere && state.metadata?.standardInfo?.batteryPercent !== undefined
        ? state.metadata.standardInfo.batteryPercent
        : profile.lastBatteryPercent;

    const statusText = isConnectedHere
      ? c.statusConnected
      : isConnectingHere
        ? state.connectionStatus === "reconnecting" && state.reconnectStatus
          ? interpolate(c.statusReconnecting, {
              attempt: state.reconnectStatus.attempt,
              max: state.reconnectStatus.maxAttempts,
            })
          : c.statusConnecting
        : c.statusDisconnected;

    const statusBadgeEl = createEl("span", {
      className: "badge-card-status",
      text: statusText,
      attrs: {
        "data-tone": isConnectedHere ? "ok" : isConnectingHere ? "info" : "neutral",
      },
    });

    const batteryText = batteryPercent !== null ? `${batteryPercent}%` : c.valueNotRead;
    const isLowBattery = batteryPercent !== null && batteryPercent < 20;
    const batteryBadgeEl = createEl(
      "span",
      {
        className: "badge-card-battery",
        attrs: isLowBattery ? { "data-tone": "warn" } : {},
      },
      [
        createStudioIcon("battery", 15),
        createEl("span", {
          text: isLowBattery ? `${batteryText} · ${h.batteryNoteLow}` : batteryText,
        }),
      ]
    );

    const paletteIdx = DEVICE_ACCENT_PALETTE.indexOf(profile.accentHex);

    const sendLabel = isConnectedHere ? h.cardActionSend : h.cardActionConnectAndSend;
    const primarySendBtn = createIconButton(
      isPrimaryHero ? "btn btn-hero-white badge-card-send" : "btn btn-primary badge-card-send",
      "send",
      isConnectingHere ? c.statusConnecting : sendLabel,
      15
    );
    primarySendBtn.button.disabled = isBusy;
    primarySendBtn.button.addEventListener("click", () => {
      this.handlers.onSelectBadgeAndPush(profile.id);
    });

    const detailBtn = createIconButton(
      isPrimaryHero ? "btn btn-sm hero-ghost-btn" : "btn btn-sm",
      "info",
      h.cardActionDetail,
      14
    );
    detailBtn.button.addEventListener("click", () => {
      this.handlers.onOpenDeviceDetail(profile.id);
    });

    const actionNodes: HTMLElement[] = [primarySendBtn.button, detailBtn.button];
    if (isConnectedHere) {
      const disconnectBtn = createIconButton(
        isPrimaryHero ? "btn btn-sm hero-ghost-btn" : "btn btn-sm",
        "power",
        c.btnDisconnect,
        14
      );
      disconnectBtn.button.disabled = state.connectionStatus === "uploading";
      disconnectBtn.button.addEventListener("click", () => this.handlers.onDisconnect());
      actionNodes.push(disconnectBtn.button);
    }

    const nameRow = createEl("div", { className: "badge-card-name-row" }, [
      createEl("span", { className: "device-accent-dot", attrs: { "aria-hidden": "true" } }),
      createEl("span", { className: "badge-card-name", text: profile.nickname }),
    ]);

    return createEl(
      "article",
      {
        className: isPrimaryHero ? "home-badge-card home-badge-hero" : "home-badge-card",
        attrs: {
          "data-accent-index": String(paletteIdx >= 0 ? paletteIdx : 0),
          "data-connected": String(isConnectedHere),
        },
      },
      [
        createEl("div", { className: "badge-card-header" }, [
          createMiniDialAvatar(),
          createEl("div", { className: "badge-card-info" }, [
            nameRow,
            createEl("div", { className: "badge-card-badges" }, [statusBadgeEl, batteryBadgeEl]),
          ]),
        ]),
        createEl("div", { className: "badge-card-actions" }, actionNodes),
      ]
    );
  }
}
