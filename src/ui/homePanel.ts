/** @module ui/homePanel */
import { interpolate } from "../i18n/i18n";
import type { TranslationSchema } from "../i18n/types";
import { hasPublishableBadgeContent } from "../imaging/badgeCompositor";
import type { AppStateSnapshot } from "../state/appStore";
import { drawCircularThumbnailCanvas } from "./badgeStatusHelper";
import { createButton, createEl, createIconButton, type IconButtonHandle } from "./domHelpers";
import type { GuideHint } from "./firstRun";
import { createStudioIcon } from "./icons";

/** Bundled sample available to both the decorative preview and the editor. */
export const SAMPLE_PHOTO_URL = `${import.meta.env.BASE_URL}sample-fuji.jpg`;

/** Home actions implemented by the shared application controller. */
export interface HomePanelHandlers {
  /** Opens the local photo picker. */
  readonly onPickPhoto: () => void;
  /** Loads the bundled photo into the editor. */
  readonly onTrySample: () => void;
  /** Continues the current draft in the editor. */
  readonly onContinueEditing: () => void;
  /** Starts editing with the text panel open. */
  readonly onCreateTextOnly: () => void;
  /** Opens the Bluetooth chooser. */
  readonly onConnectBadge: () => void;
  /** Tries the given saved badge. */
  readonly onReconnectLast: (deviceId: string) => void;
  /** Retries the failed connection through the controller’s recovery path. */
  readonly onRetryFailedConnect: () => void;
  /** Cancels a pending automatic reconnection. */
  readonly onCancelReconnect: () => void;
  /** Opens settings for just the badge displayed on Home. */
  readonly onManageBadge: (deviceId: string) => void;
}

/** Shared content of the connection control on Home. */
export interface HomeLinkState {
  /** Whether a connection operation disables the button. */
  readonly busy: boolean;
  /** Whether the button cancels a running recovery. */
  readonly recovering: boolean;
  /** Text shown on the connection button. */
  readonly label: string;
  /** Action executed by either instance of the connection button. */
  readonly action: () => void;
  /** Connection status or recovery advice. */
  readonly copy: string;
  /** Instructions used when the first-visit guide highlights the button. */
  readonly guideCopy: string;
}

/** Home setup, editing entry points, and the status card for the displayed badge. */
export class HomePanel {
  /** Root of the home screen. */
  public readonly element: HTMLElement;
  /** Preferred focus target on return to Home. */
  public get primaryCtaBtn(): HTMLButtonElement {
    return this.setup.hidden ? this.photo.button : this.setupConnect.button;
  }
  /** Current first-visit hint, or null while connection is in progress. */
  public guideHint: GuideHint | null = null;

  /** Current translations. */
  private dict: TranslationSchema;
  /** User's choice to access the editor during this session without connecting. */
  private offlinePreview = false;
  /** Action shared by the Home setup and status card recovery buttons. */
  private connectionAction: () => void = () => undefined;
  /** ID of the badge shown in the status card. */
  private displayedBadgeId: string | null = null;
  /** Most recent state, for toggling the offline preview. */
  private rendered: {
    /** Store snapshot at the last render. */
    state: AppStateSnapshot;
    /** Image displayed in the circular draft preview. */
    canvas: HTMLCanvasElement | null;
    /** Browser connection capability. */
    available: boolean;
  } | null = null;

  /** Main heading for the active setup or creation panel. */
  private readonly heading = createEl("h1", { className: "home-title" });
  /** Setup panel containing first-connection help and action. */
  private readonly setup: HTMLElement;
  /** Setup instructions and connection progress. */
  private readonly setupCopy = createEl("p", { className: "home-description", attrs: { role: "status" } });
  /** Prominent connect/recovery control on the setup screen. */
  private readonly setupConnect: IconButtonHandle;
  /** Opens photo tools without a Bluetooth session. */
  private readonly offline: HTMLButtonElement;
  /** Panel with creation and draft actions. */
  private readonly create: HTMLElement;
  /** Instructions beside the creation actions. */
  private readonly createCopy = createEl("p", { className: "home-description" });
  /** Opens the native file picker. */
  private readonly photo: IconButtonHandle;
  /** Opens the text editor. */
  private readonly text: IconButtonHandle;
  /** Loads the bundled sample. */
  private readonly sample: HTMLButtonElement;
  /** Continues the existing draft. */
  private readonly resume: HTMLButtonElement;
  /** Previous draft's circular preview canvas. */
  private readonly thumbnail = createEl("canvas", { className: "home-photo-preview" });
  /** Decorative photo shown when there is no draft. */
  private readonly image = createEl("img", {
    className: "home-photo-preview",
    attrs: { alt: "", src: SAMPLE_PHOTO_URL, width: "400", height: "400", fetchpriority: "high" },
  });
  /** Photo-load failure message. */
  private readonly error = createEl("p", { className: "inline-alert", attrs: { role: "alert", "data-tone": "err" } });
  /** Connected or optional setup card below the hero. */
  private readonly deviceCard: HTMLElement;
  /** Name of the displayed badge. */
  private readonly deviceName = createEl("h2");
  /** Current status or recovery advice. */
  private readonly deviceStatus = createEl("p", { attrs: { role: "status" } });
  /** Directly opens the displayed badge’s settings or recovers the connection. */
  private readonly deviceButton: HTMLButtonElement;

  /** Builds the static Home layout and binds its controls. */
  public constructor(initialDict: TranslationSchema, handlers: HomePanelHandlers) {
    this.dict = initialDict;
    const h = initialDict.home;
    this.setupConnect = createIconButton("btn btn-primary home-setup-connect", "bluetooth", h.btnConnectBadge, 18);
    this.setupConnect.button.addEventListener("click", () => this.connectionAction());
    this.offline = createButton("btn home-link", h.btnOffline);
    this.offline.addEventListener("click", () => {
      if (!this.rendered) return;
      const { state, canvas, available } = this.rendered;
      this.offlinePreview = true;
      this.render(state, canvas, available);
      this.photo.button.focus({ preventScroll: true });
    });
    this.setup = createEl("div", {}, [
      this.setupCopy,
      createEl("div", { className: "home-actions" }, [this.setupConnect.button]),
      this.offline,
    ]);

    this.photo = createIconButton("btn btn-primary", "photo", h.btnPickPhoto, 18);
    this.photo.button.addEventListener("click", handlers.onPickPhoto);
    this.text = createIconButton("btn home-link", "text", h.btnTextOnly, 17);
    this.text.button.addEventListener("click", handlers.onCreateTextOnly);
    this.sample = createButton("btn home-link home-small-link", h.btnSample);
    this.sample.addEventListener("click", handlers.onTrySample);
    this.resume = createButton("btn home-link home-small-link", h.btnContinueEdit);
    this.resume.addEventListener("click", handlers.onContinueEditing);
    this.create = createEl("div", {}, [
      this.createCopy,
      createEl("div", { className: "home-actions" }, [this.photo.button, this.text.button]),
      this.sample,
      this.resume,
    ]);

    this.deviceButton = createButton("btn btn-secondary", h.btnManage);
    this.deviceButton.addEventListener("click", () => {
      if (this.displayedBadgeId) handlers.onManageBadge(this.displayedBadgeId);
      else this.connectionAction();
    });
    this.deviceCard = createEl("div", { className: "home-connection" }, [
      createEl("span", { className: "home-connection-icon" }, [createStudioIcon("bluetooth", 20)]),
      createEl("div", { className: "home-connection-copy" }, [this.deviceName, this.deviceStatus]),
      this.deviceButton,
    ]);
    this.element = createEl("section", { className: "screen-view home-screen", attrs: { id: "home" } }, [
      createEl("div", { className: "home-hero" }, [
        createEl("div", { className: "home-hero-info" }, [this.heading, this.setup, this.create]),
        createEl("div", { className: "home-visual", attrs: { "aria-hidden": "true" } }, [
          createEl("div", { className: "home-orbit" }),
          createEl("div", { className: "home-disc" }, [this.image, this.thumbnail]),
        ]),
      ]),
      this.error,
      this.deviceCard,
    ]);
    this.handlers = handlers;
  }

  /** Callbacks shared with the application controller. */
  private readonly handlers: HomePanelHandlers;

  /** Updates the Home strings without losing the draft or step. */
  public updateLocale(dict: TranslationSchema, state: AppStateSnapshot, canvas: HTMLCanvasElement | null, available: boolean): void {
    this.dict = dict;
    this.render(state, canvas, available);
  }

  /** Reflects the shared store without maintaining a second Bluetooth connection. */
  public render(state: AppStateSnapshot, canvas: HTMLCanvasElement | null, available = true): void {
    this.rendered = { state, canvas, available };
    const h = this.dict.home;
    const connected = state.connectionStatus === "connected" ? state.metadata : null;
    const showCreate = !!connected || this.offlinePreview || !available;
    const hasDraft = hasPublishableBadgeContent(Boolean(state.sourceMeta), state.textOverlay);
    this.displayedBadgeId = connected?.deviceId ?? null;
    const activeProfile = state.savedDevices.find((profile) => profile.id === this.displayedBadgeId);
    const link = this.resolveConnection(state);

    this.heading.textContent = showCreate ? h.heading : h.setupHeading;
    this.setup.hidden = showCreate;
    this.create.hidden = !showCreate;
    this.setupCopy.textContent = link.copy;
    this.setupConnect.labelEl.textContent = link.label;
    this.setupConnect.button.disabled = link.busy;
    this.setupConnect.button.classList.toggle("btn-primary", !link.recovering);
    this.setupConnect.button.classList.toggle("btn-secondary", link.recovering);
    this.connectionAction = link.action;
    this.offline.textContent = h.btnOffline;
    this.createCopy.textContent = h.lead;
    this.photo.labelEl.textContent = h.btnPickPhoto;
    this.photo.button.disabled = state.isLoadingImage;
    this.text.labelEl.textContent = h.btnTextOnly;
    this.sample.textContent = h.btnSample;
    this.sample.disabled = state.isLoadingImage;
    this.sample.hidden = hasDraft;
    this.resume.textContent = h.btnContinueEdit;
    this.resume.hidden = !hasDraft;
    this.image.hidden = hasDraft && showCreate;
    this.thumbnail.hidden = !hasDraft || !showCreate;
    if (!this.thumbnail.hidden) drawCircularThumbnailCanvas(this.thumbnail, canvas);

    this.error.hidden = !state.imageLoadError;
    this.error.textContent = state.imageLoadError ?? "";
    this.deviceCard.hidden = !showCreate;
    this.deviceName.textContent = connected
      ? activeProfile?.nickname ?? (connected.deviceName || "BG02")
      : this.dict.badges.screenTitle;
    this.deviceStatus.textContent = connected
      ? this.dict.badges.statusConnected
      : available ? link.copy : h.offlineOnly;
    this.deviceStatus.classList.toggle("home-online", !!connected);
    this.deviceButton.hidden = !available;
    this.deviceButton.disabled = !connected && link.busy;
    this.deviceButton.textContent = connected ? h.btnManage : link.label;
    if (connected) {
      this.deviceButton.setAttribute("aria-label", interpolate(h.manageNamed, { name: this.deviceName.textContent }));
    } else {
      this.deviceButton.removeAttribute("aria-label");
    }

    this.guideHint = showCreate
      ? { target: this.photo.button, title: h.guidePhotoTitle, copy: h.guidePhotoCopy }
      : link.busy || link.recovering
        ? null
        : { target: this.setupConnect.button, title: h.guideConnectTitle, copy: link.guideCopy };
  }

  /** Resolves the display and action for setup, reconnection, and permission recovery. */
  private resolveConnection(state: AppStateSnapshot): HomeLinkState {
    const h = this.dict.home;
    const handlers = this.handlers;
    const base = { busy: false, recovering: false, guideCopy: h.guideConnectCopy };
    if (state.reconnectStatus) {
      const { targetDeviceId, attempt, maxAttempts } = state.reconnectStatus;
      const name = state.savedDevices.find((profile) => profile.id === targetDeviceId)?.nickname ?? "BG02";
      return { ...base, recovering: true, label: h.btnCancelReconnect, action: handlers.onCancelReconnect,
        copy: interpolate(h.statusReconnectingNamed, { name, attempt, max: maxAttempts }) };
    }
    if (state.connectionStatus === "connecting" || state.uploadProgress) {
      const targetId = state.pendingConnectDeviceId ?? state.reconnectPrefs.lastActiveDeviceId;
      const name = state.savedDevices.find((profile) => profile.id === targetId)?.nickname ?? "BG02";
      return { ...base, busy: true, label: h.btnConnectBadge, action: handlers.onConnectBadge,
        copy: interpolate(h.statusConnectingNamed, { name }) };
    }
    const failure = state.sendOutcome?.kind === "connect_failed" ? state.sendOutcome : null;
    if (failure?.connectFailureReason === "permission_unavailable") {
      const copy = this.dict.send.connectPermissionUnavailableBody;
      return { ...base, label: h.btnReselectBluetooth, action: handlers.onConnectBadge, copy, guideCopy: copy };
    }
    if (failure) {
      const copy = this.dict.send.connectGattFailedBody;
      return { ...base, label: h.btnRetryConnect, action: handlers.onRetryFailedConnect, copy, guideCopy: copy };
    }
    const saved = state.savedDevices.find((profile) => profile.id === state.reconnectPrefs.lastActiveDeviceId)
      ?? state.savedDevices[0];
    return saved
      ? { ...base, label: h.btnReconnectBadge, action: () => handlers.onReconnectLast(saved.id),
          copy: interpolate(h.statusDisconnectedNamed, { name: saved.nickname }), guideCopy: h.guideConnectStep }
      : { ...base, label: h.btnConnectBadge, action: handlers.onConnectBadge, copy: h.guideConnectStep };
  }
}
