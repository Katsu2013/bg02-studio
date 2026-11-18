/**
 * @module main
 * Root application controller orchestrating the 5-screen BG02 Studio workflow,
 * safe multi-device Web Bluetooth state reconciliation, isolated draft compositing,
 * immutable retry sessions, and scoped Service Worker offline verification.
 */

import { Bg02Client } from "./ble/bg02Client";
import { byteSum32 } from "./ble/frameCodec";
import {
  Bg02ConnectError,
  Bg02ProtocolError,
  isRetryableUploadError,
  type Bg02ConnectFailureReason,
  type ClockDialInfo,
  type ConnectedDeviceMetadata,
  type StandardDeviceInfo,
} from "./ble/types";
import {
  DEFAULT_DISPLAY_SIZE_PX,
  TELEMETRY_POLL_INTERVAL_MS,
  UPLOAD_MAX_AUTO_RETRIES,
  UPLOAD_RETRY_SETTLE_DELAY_MS,
} from "./constants/ble";
import { formatErrorForUser, I18nService, interpolate } from "./i18n/i18n";
import type { LocaleCode } from "./i18n/types";
import {
  composeAndEncodeBadge,
  computeContainRelativeScale,
  computeCoverScale,
  createDefaultTransform,
  loadLocalImageFile,
  renderExportComposition,
  renderPreviewWithGuides,
} from "./imaging/badgeCompositor";
import { assessDeviceUploadSupport } from "./imaging/jpegInspector";
import type { CompositedBadgeResult } from "./imaging/types";
import { AppStore, type AppScreenId, type AppStateSnapshot, type SendOutcomeState } from "./state/appStore";
import {
  addDeletedDeviceId,
  clearDeletedDeviceId,
  loadDeletedDeviceIds,
  pickStartupReconnectTarget,
  removeDeviceProfile,
  renameDeviceProfile,
  resolveUploadReconnectPlan,
  saveDeletedDeviceIds,
  saveDeviceProfiles,
  saveReconnectPrefs,
  upsertDeviceProfile,
} from "./state/deviceRegistry";
import { verifyScopedServiceWorkerReady } from "./state/offlineStatus";
import {
  evaluateUploadGate,
  reconcilePopStateSendTarget,
  resolveSendTargetView,
  shouldCommitEditorProceedToSend,
  verifyPreparedSendConsistency,
  type FrozenUploadSession,
  type PendingPrepareTarget,
} from "./state/sendSession";
import { BadgeEditor } from "./ui/badgeEditor";
import { BadgesListPanel } from "./ui/badgesListPanel";
import { DeviceDetailPanel } from "./ui/deviceDetailPanel";
import { createButton, createEl, replaceChildrenSafe } from "./ui/domHelpers";
import { afterSplash, createFirstRunGuide, type FirstRunGuide } from "./ui/firstRun";
import { HomePanel, SAMPLE_PHOTO_URL } from "./ui/homePanel";
import { createStudioIcon } from "./ui/icons";
import { LogPanel } from "./ui/logPanel";
import {
  applyScreenVisibility,
  focusAfterNavigation,
  resolvePopStateRoute,
  shouldPushHistoryEntry,
  type ScreenRouteState,
} from "./ui/screenRouter";
import { SendPanel } from "./ui/sendPanel";

/** Debounce interval (ms) coalescing rapid slider/text drags into JPEG encodes. */
export const ENCODE_DEBOUNCE_MS = 100;

/** Backoff intervals (ms) between automatic drop-reconnect attempts. */
export const AUTO_RECONNECT_DELAYS_MS: ReadonlyArray<number> = [1200, 2500, 4500];

/** Default local Baseline JPEG download filename. */
export const DEFAULT_EXPORT_FILENAME = "bg02-badge-240x240.jpg";

/** Resolved canvas dimensions and dial bezel mask shape. */
export interface BadgeTargetGeometry {
  /** Pixel width of exported JPEG. */
  readonly width: number;
  /** Pixel height of exported JPEG. */
  readonly height: number;
  /** Preview bezel shape (`"round"` or `"square"`). */
  readonly shape: "round" | "square";
}

/** Optional injected test doubles for UI integration testing without physical Bluetooth hardware. */
export interface Bg02StudioDeps {
  /** Custom BLE client instance (e.g. multi-device mock in tests). */
  readonly client?: Bg02Client;
  /** Custom pre-configured store instance. */
  readonly store?: AppStore;
  /** Override for Web Bluetooth availability check. */
  readonly webBluetoothAvailable?: boolean;
  /** Skip browser Service Worker registration during unit/DOM tests. */
  readonly disableServiceWorkerRegistration?: boolean;
  /** Optional custom badge JPEG composition/encoding function (e.g. delayed mock in P1 race tests). */
  readonly composeAndEncodeFn?: typeof composeAndEncodeBadge;
}

/**
 * Resolves effective display resolution and bezel shape from `ClockDialInfo` (`0x20/0x02`).
 *
 * @param dialInfo - Reported device dial specs, or `null` when unconnected.
 * @returns Normalized width, height, and shape defaulting to `240×240` circular.
 */
export function resolveTargetGeometry(
  dialInfo: ClockDialInfo | null | undefined
): BadgeTargetGeometry {
  if (!dialInfo || dialInfo.width <= 0 || dialInfo.height <= 0) {
    return {
      width: DEFAULT_DISPLAY_SIZE_PX,
      height: DEFAULT_DISPLAY_SIZE_PX,
      shape: "round",
    };
  }
  return {
    width: dialInfo.width,
    height: dialInfo.height,
    shape: dialInfo.shape === "square" ? "square" : "round",
  };
}

/**
 * Top-level BG02 Studio application coordinator binding 5 screens,
 * safe BLE targeting, image composition, and accessibility live regions.
 */
export class Bg02StudioApp {
  /** Translation service managing JA/EN copy and localized errors. */
  private readonly i18n: I18nService;
  /** Central reactive application state store. */
  private readonly store: AppStore;
  /** Web Bluetooth GATT protocol client for BG02 badges. */
  private readonly client: Bg02Client;
  /** Cached flag indicating whether `navigator.bluetooth` is supported. */
  private readonly webBluetoothAvailable: boolean;
  /** Monotonic sequence invalidating in-flight Editor->Send async transitions when leaving Editor. */
  private proceedToSendSeq = 0;
  /** Monotonic sequence invalidating older auto-reconnect loops on disconnect, switch, or deletion. */
  private reconnectLoopSeq = 0;
  /** Optional resolver aborting an active reconnect backoff sleep immediately on cancellation. */
  private reconnectSleepResolver: ((proceed: boolean) => void) | null = null;

  /** Status pill displaying offline Service Worker readiness. */
  private readonly offlinePillEl: HTMLSpanElement;
  /** Registered-badges navigation in the header. */
  private readonly registeredBadgesButton: HTMLButtonElement;
  /** Header button that returns Home. */
  private readonly headerBrandButton: HTMLButtonElement;
  /** Translatable label of the registered-badges navigation. */
  private readonly registeredBadgesLabel: HTMLSpanElement;
  /** Footer toggle button switching UI language to Japanese. */
  private readonly langJaBtn: HTMLButtonElement;
  /** Footer toggle button switching UI language to English. */
  private readonly langEnBtn: HTMLButtonElement;
  /** Language group for localized accessible labels. */
  private readonly languageGroup: HTMLElement;
  /** First-visit dialog, attached after the logo screen closes. */
  private firstRunGuide: FirstRunGuide | null = null;
  /** Abortable bundled-photo load on the Home screen. */
  private sampleLoad: AbortController | null = null;
  /** Polite screen-reader live region element. */
  private readonly srStatusEl: HTMLDivElement;
  /** Privacy footer note paragraph element. */
  private readonly footerPrivacyEl: HTMLParagraphElement;
  /** Hidden file input backing photo selection on Home and Editor. */
  private readonly hiddenFileInput: HTMLInputElement;

  /** Screen 1 panel: Home launcher and badge status cards. */
  private readonly homePanel: HomePanel;
  /** Screen 2 panel: Circular photo and text badge editor. */
  private readonly badgeEditor: BadgeEditor;
  /** Screen 3 panel: Send confirmation and transfer progress view. */
  private readonly sendPanel: SendPanel;
  /** Screen 4 panel: Saved badges switcher and registry manager. */
  private readonly badgesListPanel: BadgesListPanel;
  /** Screen 5 panel: Individual badge settings, telemetry, and unregister view. */
  private readonly deviceDetailPanel: DeviceDetailPanel;
  /** Slide/collapsible communication log drawer component. */
  private readonly logPanel: LogPanel;
  /** Map from screen route identifiers to their root `<section>` elements. */
  private readonly screenPanels: Readonly<Record<AppScreenId, HTMLElement>>;

  /** Hidden 240x240 canvas used when encoding circular JPEG payloads. */
  private readonly offscreenExportCanvas: HTMLCanvasElement;
  /** Currently decoded `HTMLImageElement` loaded into the editor, if any. */
  private loadedImage: HTMLImageElement | null = null;
  /** Monotonic counter discarding stale asynchronous encode results. */
  private encodeSequence = 0;
  /** Debounce timer handle for re-rendering and encoding editor drafts. */
  private encodeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Periodic interval querying battery and storage telemetry every 30s. */
  private telemetryPollTimer: ReturnType<typeof setInterval> | null = null;
  /** Exponential-backoff timeout handle for automatic reconnection attempts. */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Flag canceling pending automatic reconnect loops after explicit disconnect. */
  private reconnectCancelled = false;
  /** Monotonic sequence guarding overlapping BLE connection attempts. */
  private connectAttemptSeq = 0;
  /** Lock preventing concurrent BLE image transfers. */
  private uploadInFlight = false;
  /** Flag opening the text card automatically upon entering the editor from Home. */
  private openTextWhenEnteringEditor = false;
  /** Monotonic token invalidating async send preparations whenever target or draft changes. */
  private prepareSequence = 0;
  /** Active JPEG composition/encoding implementation (injectable for async race tests). */
  private readonly composeAndEncode: typeof composeAndEncodeBadge;

  /**
   * Constructs the 5-screen application inside `rootContainer`.
   *
   * @param rootContainer - Host DOM mount node.
   * @param deps - Optional dependency overrides for automated E2E tests.
   */
  public constructor(rootContainer: HTMLElement, deps: Bg02StudioDeps = {}) {
    this.i18n = new I18nService();
    this.store = deps.store ?? new AppStore();
    this.composeAndEncode = deps.composeAndEncodeFn ?? composeAndEncodeBadge;
    this.client =
      deps.client ??
      new Bg02Client((level, msg) => {
        this.store.appendLog(level, msg);
      });
    this.webBluetoothAvailable =
      deps.webBluetoothAvailable ??
      (typeof navigator !== "undefined" && Boolean(navigator.bluetooth));

    this.offscreenExportCanvas = document.createElement("canvas");
    this.offscreenExportCanvas.width = DEFAULT_DISPLAY_SIZE_PX;
    this.offscreenExportCanvas.height = DEFAULT_DISPLAY_SIZE_PX;

    this.hiddenFileInput = createEl("input", {
      attrs: {
        type: "file",
        accept: "image/*",
        hidden: "true",
        "aria-hidden": "true",
      },
    });
    this.hiddenFileInput.addEventListener("change", () => {
      const file = this.hiddenFileInput.files?.[0];
      this.hiddenFileInput.value = "";
      if (file) {
        void this.handleSelectImageFile(file);
      }
    });

    // Build slim top app header
    const dict = this.i18n.t;
    this.headerBrandButton = createEl("button", { className: "app-brand", attrs: { type: "button" } }, [
      createEl("img", { attrs: { src: "./icons/studio.svg", width: "36", height: "36", alt: "" } }),
      createEl("span", { className: "app-brand-title", text: dict.header.appTitle }),
    ]);
    this.headerBrandButton.addEventListener("click", () => this.navigateTo("home", { direction: "back" }));
    this.registeredBadgesLabel = createEl("span", { text: dict.badges.screenTitle });
    this.registeredBadgesButton = createEl("button", {
      className: "registered-badges-link",
      attrs: { type: "button" },
    }, [createStudioIcon("badge", 18), this.registeredBadgesLabel]);
    this.registeredBadgesButton.addEventListener("click", () => {
      const onSend = this.store.snapshot.activeScreen === "send";
      this.navigateTo("badges", { direction: "forward", badgesReturnScreen: onSend ? "send" : "home" });
    });

    this.offlinePillEl = createEl("span", {
      className: "mini-pill",
      text: dict.header.offlineReadyBadge,
      attrs: { "data-tone": "ok" },
    });
    this.offlinePillEl.hidden = true;

    this.langJaBtn = createButton("btn btn-sm lang-btn", "JA");
    this.langEnBtn = createButton("btn btn-sm lang-btn", "EN");
    this.langJaBtn.addEventListener("click", () => this.switchLocale("ja"));
    this.langEnBtn.addEventListener("click", () => this.switchLocale("en"));
    this.syncLangButtons();

    this.languageGroup = createEl(
      "div",
      { className: "lang-switch", attrs: { role: "group", "aria-label": dict.header.languageLabel } },
      [this.langJaBtn, this.langEnBtn]
    );

    const headerEl = createEl("header", { className: "app-header" }, [
      createEl("div", { className: "app-header-inner" }, [
        this.headerBrandButton,
        this.registeredBadgesButton,
      ]),
    ]);

    this.srStatusEl = createEl("div", {
      className: "sr-only",
      attrs: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
    });

    // Instantiate all 5 Screen Panels
    this.logPanel = new LogPanel(dict, {
      onCopyLogs: () => void this.handleCopyLogs(),
      onClearLogs: () => this.store.clearLogs(),
    });

    this.homePanel = new HomePanel(dict, {
      onPickPhoto: () => this.openPhotoPicker(),
      onTrySample: () => void this.handleTrySample(),
      onContinueEditing: () => this.navigateTo("editor", { direction: "forward" }),
      onCreateTextOnly: () => {
        this.selectDisplayedBadgeForDraft();
        this.openTextWhenEnteringEditor = true;
        this.store.patchState({ textEditorOpen: true });
        this.navigateTo("editor", { direction: "forward", openTextFocus: true });
      },
      onConnectBadge: () =>
        void this.handleConnect({
          useChooser: true,
          setAsSendTarget: true,
          explicitUserAction: true,
        }),
      onReconnectLast: (deviceId) =>
        void this.handleConnect({
          useChooser: !this.client.hasLiveDevice(deviceId),
          targetDeviceId: deviceId,
          setAsSendTarget: true,
          explicitUserAction: true,
        }),
      onRetryFailedConnect: () => void this.handleRetryFailedConnect(true),
      onCancelReconnect: () => void this.handleDisconnect(),
      onManageBadge: (deviceId) => {
        this.store.patchState({ detailForgetNotice: null });
        this.navigateTo("device-detail", { direction: "forward", detailDeviceId: deviceId, badgesReturnScreen: "home" });
      },
    });

    this.badgeEditor = new BadgeEditor(dict, {
      onBackHome: () => this.navigateTo("home", { direction: "back" }),
      onPickPhoto: () => this.openPhotoPicker(),
      onDropImageFile: (file) => void this.handleSelectImageFile(file),
      onChangeTransform: (patch) => {
        this.store.updateTransform(patch);
        this.schedulePreviewAndEncode();
      },
      onFitCover: () => {
        this.store.updateTransform({
          offsetX: 0,
          offsetY: 0,
          scale: 1,
          rotationDeg: 0,
          backgroundColor: this.store.snapshot.transform.backgroundColor,
        });
        this.schedulePreviewAndEncode();
      },
      onFitContain: () => {
        const geom = resolveTargetGeometry(this.store.snapshot.metadata?.dialInfo);
        const containScale = this.loadedImage
          ? computeContainRelativeScale(
              this.loadedImage.naturalWidth,
              this.loadedImage.naturalHeight,
              geom.width,
              geom.height
            )
          : 1;
        this.store.updateTransform({ offsetX: 0, offsetY: 0, scale: containScale });
        this.schedulePreviewAndEncode();
      },
      onRotateStep: (deltaDeg) => {
        const current = this.store.snapshot.transform.rotationDeg;
        let next = Math.round(current + deltaDeg) % 360;
        if (next > 180) next -= 360;
        if (next <= -180) next += 360;
        this.store.updateTransform({ rotationDeg: next });
        this.schedulePreviewAndEncode();
      },
      onResetTransform: () => {
        this.store.updateTransform({ ...createDefaultTransform() });
        this.schedulePreviewAndEncode();
      },
      onToggleTextEditor: (open) => {
        this.store.patchState({ textEditorOpen: open });
      },
      onChangeTextOverlay: (patch) => {
        this.store.updateTextOverlay(patch);
        this.schedulePreviewAndEncode();
      },
      onChangeEncoding: (patch) => {
        this.store.updateEncoding(patch);
        this.schedulePreviewAndEncode();
      },
      onNextSend: () => void this.handleProceedToSend(),
      onDownloadJpeg: () => void this.handleDownloadJpeg(),
    });

    this.sendPanel = new SendPanel(dict, {
      onBackToEditor: () => this.navigateTo("editor", { direction: "back" }),
      onDoneHome: () => {
        this.store.patchState({ sendOutcome: null, uploadProgress: null });
        this.navigateTo("home", { direction: "back" });
      },
      onOpenMyBadges: () =>
        this.navigateTo("badges", { direction: "forward", badgesReturnScreen: "send" }),
      onSelectSavedTarget: (deviceId) => {
        if (
          this.store.snapshot.reconnectStatus &&
          this.store.snapshot.reconnectStatus.targetDeviceId !== deviceId
        ) {
          this.cancelAutoReconnect();
        }
        const hadPrepare = this.store.snapshot.preparingSend !== null;
        this.invalidatePendingPrepare(false);
        this.store.patchState({
          selectedSendTargetId: deviceId,
          targetDriftNotice: false,
          sendOutcome: hadPrepare
            ? {
                kind: "prepare_aborted",
                targetDeviceId: deviceId,
                targetDeviceName:
                  this.store.snapshot.savedDevices.find((d) => d.id === deviceId)?.nickname ??
                  "BG02",
                message: this.i18n.t.send.statePrepareAbortedTitle,
              }
            : null,
          frozenRetrySession: null,
        });
      },
      onChooseTargetViaPicker: () => void this.handleConnectFromSendPicker(),
      onConnectSelectedTarget: () => void this.handleConnectSelectedTargetAndSend(false),
      onSendNow: () => void this.handleSendNow(),
      onRetryFrozenUpload: () => void this.handleRetryFrozenUpload(),
      onSaveJpegFallback: () => void this.handleDownloadJpeg(),
    });

    this.badgesListPanel = new BadgesListPanel(dict, {
      onBack: () => {
        const backTarget = this.store.snapshot.badgesReturnScreen;
        this.navigateTo(backTarget, { direction: "back" });
      },
      onAddBadge: () =>
        void this.handleConnect({
          useChooser: true,
          setAsSendTarget: false,
          explicitUserAction: true,
        }),
      onRetryConnect: () => void this.handleRetryFailedConnect(false),
      onReselectBluetooth: () =>
        void this.handleConnect({
          useChooser: true,
          setAsSendTarget: false,
          explicitUserAction: true,
        }),
      onOpenDetail: (deviceId) => {
        this.store.patchState({ detailForgetNotice: null });
        this.navigateTo("device-detail", { direction: "forward", detailDeviceId: deviceId });
      },
    });

    this.deviceDetailPanel = new DeviceDetailPanel(
      dict,
      {
        onBackBadges: () => {
          this.store.patchState({ detailForgetNotice: null });
          this.navigateTo("badges", { direction: "back" });
        },
        onSendWithBadge: (deviceId) => {
          if (
            this.store.snapshot.reconnectStatus &&
            this.store.snapshot.reconnectStatus.targetDeviceId !== deviceId
          ) {
            this.cancelAutoReconnect();
          }
          this.store.patchState({
            selectedSendTargetId: deviceId,
            targetDriftNotice: false,
            sendOutcome: null,
          });
          this.navigateTo("editor", { direction: "forward" });
        },
        onConnectDevice: (deviceId) =>
          void this.handleConnect({
            useChooser: false,
            targetDeviceId: deviceId,
            setAsSendTarget: false,
            explicitUserAction: true,
          }),
        onReselectDevice: (deviceId) =>
          void this.handleConnect({
            useChooser: true,
            targetDeviceId: deviceId,
            setAsSendTarget: false,
            explicitUserAction: true,
          }),
        onDisconnect: () => void this.handleDisconnect(),
        onRefreshTelemetry: () => void this.handleRefreshTelemetry(),
        onRenameDevice: (deviceId, nickname) => this.handleRenameSavedDevice(deviceId, nickname),
        onForgetDevice: (deviceId) => this.handleForgetSavedDevice(deviceId),
        onUpdateReconnectPrefs: (patch) => this.handleUpdateReconnectPrefs(patch),
        onToggleAcceptAll: (value) => this.store.patchState({ acceptAllDevices: value }),
        onToggleWriteWithoutResponse: (value) =>
          this.store.patchState({ preferWriteWithoutResponse: value }),
        onCopyText: (text, announcement) => void this.copyTextToClipboard(text, announcement),
      },
      this.logPanel.element
    );

    this.screenPanels = {
      home: this.homePanel.element,
      editor: this.badgeEditor.element,
      send: this.sendPanel.element,
      badges: this.badgesListPanel.element,
      "device-detail": this.deviceDetailPanel.element,
    };

    const mainEl = createEl("main", { className: "app-main" }, [
      this.homePanel.element,
      this.badgeEditor.element,
      this.sendPanel.element,
      this.badgesListPanel.element,
      this.deviceDetailPanel.element,
    ]);

    this.footerPrivacyEl = createEl("p", {
      className: "app-footer-note",
      text: dict.footer.privacyGuarantee,
    });
    const footerEl = createEl("footer", { className: "app-footer" }, [
      this.footerPrivacyEl,
      createEl("div", { className: "app-footer-controls" }, [this.offlinePillEl, this.languageGroup]),
    ]);

    replaceChildrenSafe(rootContainer, [
      headerEl,
      this.srStatusEl,
      this.hiddenFileInput,
      mainEl,
      footerEl,
    ]);

    // Subscribe to reactive state updates
    this.store.subscribe((state) => {
      this.renderAll(state);
    });

    // Browser Back/Forward History reconciliation
    if (typeof window !== "undefined") {
      if (typeof window.history?.replaceState === "function") {
        window.history.replaceState(
          { screen: "home", detailDeviceId: null, badgesReturnScreen: "home" },
          ""
        );
      }
      window.addEventListener("popstate", (ev) => {
        const route = resolvePopStateRoute(ev.state);
        if (route.screen !== "home") this.cancelSampleLoad();
        this.invalidatePendingPrepare(true);
        if (route.screen !== "editor") {
          this.invalidatePendingProceedToSend();
        }
        const current = this.store.snapshot;
        let nextTargetId = current.selectedSendTargetId;
        let targetDriftNotice = current.targetDriftNotice;

        if (route.screen === "send") {
          const rec = reconcilePopStateSendTarget({
            routeContextDeviceId: route.sendContextDeviceId ?? null,
            currentSelectedTargetId: current.selectedSendTargetId,
            clientConnected: this.client.isConnected,
            clientActiveId: this.client.activeId,
          });
          nextTargetId = rec.nextSelectedTargetId;
          targetDriftNotice = rec.targetDriftDetected;
        }

        this.store.patchState({
          activeScreen: route.screen,
          detailDeviceId: route.detailDeviceId,
          badgesReturnScreen: route.badgesReturnScreen ?? "home",
          selectedSendTargetId: nextTargetId,
          targetDriftNotice,
        });
        applyScreenVisibility(this.screenPanels, route.screen, "back");
      });
    }

    // Bind GATT Disconnect events cleanly
    this.client.setOnDisconnect((reason, deviceId) => {
      this.invalidatePendingPrepare(true);
      this.store.patchState({
        connectionStatus: "disconnected",
        canReconnect: this.client.hasLiveDevice(deviceId),
        metadata: null,
        activeDeviceId: null,
        pendingConnectDeviceId: null,
      });

      if (reason === "unexpected") {
        if (this.uploadInFlight) {
          // Upload failure handler manages outcome banner cleanly; skip competing disconnect loop.
          return;
        }
        const prefs = this.store.snapshot.reconnectPrefs;
        const isDeleted = this.store.snapshot.deletedDeviceIds.includes(deviceId);
        if (prefs.autoRetryOnDrop && !isDeleted && this.client.hasLiveDevice(deviceId)) {
          void this.runAutoReconnectLoop(deviceId);
        }
      }
    });

    this.client.setOnBatteryChange((batteryPercent, deviceId) => {
      const snap = this.store.snapshot;
      if (snap.activeDeviceId !== deviceId || !snap.metadata || snap.metadata.deviceId !== deviceId) {
        return;
      }
      const nextMeta: ConnectedDeviceMetadata = {
        ...snap.metadata,
        standardInfo: {
          ...snap.metadata.standardInfo,
          batteryPercent,
        },
      };
      const nextSaved = upsertDeviceProfile(snap.savedDevices, {
        id: deviceId,
        advertisedName: nextMeta.deviceName ?? "BG02",
        batteryPercent,
      });
      saveDeviceProfiles(nextSaved);
      this.store.patchState({
        metadata: nextMeta,
        savedDevices: nextSaved,
      });
    });

    this.syncCanvasAndPreviewOnly();
    this.startTelemetryPoller();
    if (!deps.disableServiceWorkerRegistration) {
      this.registerServiceWorker();
    }
    void this.initializePermittedDevicesAndAutoConnect();
  }

  /**
   * Programmatically navigates between the 5 screens and updates History & focus cleanly.
   *
   * @param screen - Destination screen identifier.
   * @param options - Optional direction, detail target ID, return target, and focus override.
   */
  public navigateTo(
    screen: AppScreenId,
    options: {
      readonly direction?: "forward" | "back";
      readonly viaPopState?: boolean;
      readonly detailDeviceId?: string | null;
      readonly badgesReturnScreen?: "home" | "send";
      readonly openTextFocus?: boolean;
    } = {}
  ): void {
    const prev = this.store.snapshot;
    const viaPopState = options.viaPopState ?? false;
    const direction = options.direction ?? "forward";

    const nextDetailId =
      options.detailDeviceId !== undefined ? options.detailDeviceId : prev.detailDeviceId;
    const nextBadgesReturn = options.badgesReturnScreen ?? prev.badgesReturnScreen;

    if (shouldPushHistoryEntry(prev.activeScreen, screen, viaPopState)) {
      if (typeof window !== "undefined" && typeof window.history?.pushState === "function") {
        const routeState: ScreenRouteState = {
          screen,
          detailDeviceId: screen === "device-detail" ? nextDetailId : null,
          sendContextDeviceId: screen === "send" ? prev.selectedSendTargetId : null,
          badgesReturnScreen: nextBadgesReturn,
        };
        window.history.pushState(routeState, "");
      }
    }

    if (screen !== "send") {
      this.invalidatePendingPrepare(false);
    }
    if (screen !== "home") this.cancelSampleLoad();
    if (screen !== "editor") {
      this.invalidatePendingProceedToSend();
    }

    this.store.patchState({
      activeScreen: screen,
      detailDeviceId: nextDetailId,
      badgesReturnScreen: nextBadgesReturn,
      imageLoadError: prev.activeScreen !== screen ? null : prev.imageLoadError,
    });

    applyScreenVisibility(this.screenPanels, screen, direction);

    if (screen === "editor") {
      this.syncCanvasAndPreviewOnly();
      if (options.openTextFocus || this.openTextWhenEnteringEditor) {
        this.openTextWhenEnteringEditor = false;
        focusAfterNavigation(this.badgeEditor.textInputEl);
        return;
      }
      focusAfterNavigation(this.badgeEditor.backBtn);
    } else if (screen === "send") {
      focusAfterNavigation(this.sendPanel.backBtn);
    } else if (screen === "badges") {
      focusAfterNavigation(this.badgesListPanel.backBtn);
    } else if (screen === "device-detail") {
      focusAfterNavigation(this.deviceDetailPanel.backBtn);
    } else {
      focusAfterNavigation(this.homePanel.primaryCtaBtn);
    }
  }

  /** Cancels any pending async Editor->Send composition transition when leaving Editor. */
  private invalidatePendingProceedToSend(): void {
    this.proceedToSendSeq += 1;
  }

  /** Opens the shared hidden photo file chooser cleanly. */
  public openPhotoPicker(): void {
    this.hiddenFileInput.click();
  }

  /** Attaches the first-visit guide once the app is visually available. */
  public enableFirstRunGuide(dialog: HTMLDialogElement): void {
    this.firstRunGuide = createFirstRunGuide(dialog);
    this.syncFirstRunGuide(this.store.snapshot);
  }

  /** Anchors the guide to the current Home action and closes it on other screens. */
  private syncFirstRunGuide(state: AppStateSnapshot): void {
    this.firstRunGuide?.sync(state.activeScreen === "home" ? this.homePanel.guideHint : null);
  }

  /** Re-renders all five screen panels, logs drawer, and header status from state. */
  private renderAll(state: AppStateSnapshot): void {
    this.offlinePillEl.hidden = !state.serviceWorkerActive;
    this.headerBrandButton.disabled = this.uploadInFlight;
    this.registeredBadgesButton.disabled = this.uploadInFlight;
    applyScreenVisibility(this.screenPanels, state.activeScreen);

    this.homePanel.render(state, this.offscreenExportCanvas, this.webBluetoothAvailable);
    this.badgeEditor.render(state);
    this.sendPanel.render(state, this.offscreenExportCanvas, this.webBluetoothAvailable);
    this.badgesListPanel.render(state, this.webBluetoothAvailable);
    this.deviceDetailPanel.render(state);
    this.logPanel.render(state);
    if (state.activeScreen === "badges" || state.activeScreen === "device-detail") {
      this.registeredBadgesButton.setAttribute("aria-current", "page");
    } else {
      this.registeredBadgesButton.removeAttribute("aria-current");
    }
    this.syncFirstRunGuide(state);
  }

  /** Switches UI locale between Japanese and English and refreshes every panel. */
  private switchLocale(locale: LocaleCode): void {
    this.i18n.setLocale(locale);
    this.syncLangButtons();
    const dict = this.i18n.t;
    const state = this.store.snapshot;

    this.offlinePillEl.textContent = dict.header.offlineReadyBadge;
    this.footerPrivacyEl.textContent = dict.footer.privacyGuarantee;
    this.registeredBadgesLabel.textContent = dict.badges.screenTitle;
    this.languageGroup.setAttribute("aria-label", dict.header.languageLabel);

    this.homePanel.updateLocale(
      dict,
      state,
      this.offscreenExportCanvas,
      this.webBluetoothAvailable
    );
    this.badgeEditor.updateLocale(dict, state);
    this.sendPanel.updateLocale(
      dict,
      state,
      this.offscreenExportCanvas,
      this.webBluetoothAvailable
    );
    this.badgesListPanel.updateLocale(dict, state, this.webBluetoothAvailable);
    this.deviceDetailPanel.updateLocale(dict, state);
    this.logPanel.updateLocale(dict, state);
    this.syncFirstRunGuide(state);
  }

  /** Syncs `aria-pressed` state on the header language switcher buttons. */
  private syncLangButtons(): void {
    const loc = this.i18n.locale;
    this.langJaBtn.setAttribute("aria-pressed", String(loc === "ja"));
    this.langEnBtn.setAttribute("aria-pressed", String(loc === "en"));
  }

  /** Announces a transient status string to the polite screen-reader live region. */
  private announceStatus(text: string): void {
    this.srStatusEl.textContent = "";
    queueMicrotask(() => {
      this.srStatusEl.textContent = text;
    });
  }

  /** Queries permitted Web Bluetooth devices at startup and auto-connects when eligible. */
  private async initializePermittedDevicesAndAutoConnect(): Promise<void> {
    if (!this.webBluetoothAvailable) {
      return;
    }
    const deletedSet = new Set(loadDeletedDeviceIds());
    const liveIds = await this.client.refreshPermittedDevices(deletedSet);
    this.store.patchState({ liveDeviceIds: liveIds });

    const targetId = pickStartupReconnectTarget(
      this.store.snapshot.savedDevices,
      new Set(liveIds),
      this.store.snapshot.reconnectPrefs,
      deletedSet
    );
    if (targetId && !this.client.isConnected) {
      await this.handleConnect({
        useChooser: false,
        targetDeviceId: targetId,
        setAsSendTarget: this.store.snapshot.selectedSendTargetId === null,
        explicitUserAction: true,
      });
    }
  }

  /** Cancels any pending automatic reconnection backoff timer and clears status. */
  private cancelAutoReconnect(): void {
    this.reconnectLoopSeq += 1;
    this.reconnectCancelled = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const resolvePending = this.reconnectSleepResolver;
    this.reconnectSleepResolver = null;
    if (resolvePending) {
      resolvePending(false);
    }
    this.store.patchState({ reconnectStatus: null });
  }

  /** Waits for one reconnect backoff interval unless cancelled in the meantime. */
  private waitReconnectBackoff(delayMs: number, expectedLoopSeq: number): Promise<boolean> {
    return new Promise((resolve) => {
      this.reconnectSleepResolver = resolve;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.reconnectSleepResolver = null;
        resolve(!this.reconnectCancelled && expectedLoopSeq === this.reconnectLoopSeq);
      }, delayMs);
    });
  }

  /** Runs bounded automatic reconnection attempts after an unexpected BLE disconnect. */
  private async runAutoReconnectLoop(targetDeviceId: string): Promise<void> {
    const isTargetEligible = (): boolean =>
      !this.store.snapshot.deletedDeviceIds.includes(targetDeviceId) &&
      this.store.snapshot.savedDevices.some((d) => d.id === targetDeviceId);

    if (!isTargetEligible()) {
      return;
    }

    const myLoopSeq = ++this.reconnectLoopSeq;
    this.reconnectCancelled = false;
    const total = AUTO_RECONNECT_DELAYS_MS.length;
    let lastFailureReason: Bg02ConnectFailureReason = "gatt_failed";

    const isLoopStale = (): boolean =>
      this.reconnectCancelled || myLoopSeq !== this.reconnectLoopSeq || !isTargetEligible();

    for (let i = 0; i < total; i++) {
      if (isLoopStale() || this.client.isConnected) {
        if (myLoopSeq === this.reconnectLoopSeq) {
          this.store.patchState({ reconnectStatus: null });
        }
        return;
      }

      const attempt = i + 1;
      const delayMs = AUTO_RECONNECT_DELAYS_MS[i];
      const priorOutcome = this.store.snapshot.sendOutcome;
      this.store.patchState({
        reconnectStatus: {
          attempt,
          maxAttempts: total,
          targetDeviceId,
        },
        sendOutcome: priorOutcome?.kind === "connect_failed" ? null : priorOutcome,
      });

      const proceed = await this.waitReconnectBackoff(delayMs, myLoopSeq);
      if (!proceed || isLoopStale() || this.client.isConnected) {
        if (myLoopSeq === this.reconnectLoopSeq) {
          this.store.patchState({ reconnectStatus: null });
        }
        return;
      }

      const res = await this.handleConnectDetailed({
        useChooser: false,
        targetDeviceId,
        setAsSendTarget: false,
        isAutoReconnectAttempt: true,
      });
      if (res.connected) {
        if (myLoopSeq === this.reconnectLoopSeq) {
          this.store.patchState({ reconnectStatus: null });
        }
        return;
      }
      if (res.failureReason) {
        lastFailureReason = res.failureReason;
        if (lastFailureReason === "permission_unavailable") {
          break;
        }
      }
    }

    if (!isLoopStale() && !this.client.isConnected) {
      const targetProfile = this.store.snapshot.savedDevices.find(
        (d) => d.id === targetDeviceId
      );
      const targetName = targetProfile?.nickname ?? "BG02";
      this.store.patchState({
        reconnectStatus: null,
        sendOutcome: {
          kind: "connect_failed",
          targetDeviceId,
          targetDeviceName: targetName,
          message:
            lastFailureReason === "permission_unavailable"
              ? this.i18n.t.send.connectPermissionUnavailableBody
              : this.i18n.t.send.connectGattFailedBody,
          connectFailureReason: lastFailureReason,
        },
      });
    } else if (myLoopSeq === this.reconnectLoopSeq) {
      this.store.patchState({ reconnectStatus: null });
    }
  }

  /**
   * Invalidates any active async JPEG send preparation immediately on navigation,
   * target selection drift, or BLE connection change.
   *
   * @param showPrepareAbortedNotice - When `true`, displays a warning banner clarifying zero bytes were written.
   */
  private invalidatePendingPrepare(showPrepareAbortedNotice: boolean): void {
    this.prepareSequence += 1;
    const activePrepare = this.store.snapshot.preparingSend;
    if (!activePrepare) {
      return;
    }
    if (showPrepareAbortedNotice) {
      this.store.patchState({
        preparingSend: null,
        sendOutcome: {
          kind: "prepare_aborted",
          targetDeviceId:
            this.store.snapshot.selectedSendTargetId ?? activePrepare.targetDeviceId,
          targetDeviceName: activePrepare.targetDeviceName,
          message: this.i18n.t.send.statePrepareAbortedTitle,
        },
      });
    } else {
      this.store.patchState({ preparingSend: null });
    }
  }

  /** Opens the Web Bluetooth device picker from Screen 3 and assigns it as send target. */
  private async handleConnectFromSendPicker(): Promise<void> {
    await this.handleConnect({
      useChooser: true,
      setAsSendTarget: true,
      explicitUserAction: true,
    });
  }

  /** Connects to the currently selected send-target badge and optionally starts upload. */
  private async handleConnectSelectedTargetAndSend(alsoSend: boolean): Promise<void> {
    const failedTargetId =
      this.store.snapshot.sendOutcome?.kind === "connect_failed"
        ? this.store.snapshot.sendOutcome.targetDeviceId
        : null;
    const targetId = this.store.snapshot.selectedSendTargetId ?? failedTargetId;
    if (!targetId) {
      await this.handleConnectFromSendPicker();
      return;
    }
    const connected = await this.handleConnect({
      useChooser: false,
      targetDeviceId: targetId,
      setAsSendTarget: true,
      explicitUserAction: true,
    });
    if (connected && alsoSend) {
      await this.handleSendNow();
    }
  }

  /**
   * Retries a failed connection on Home or My Badges using the direct cached Bluetooth handle
   * when available, falling back cleanly to the chooser if permission is unavailable.
   */
  private async handleRetryFailedConnect(setAsSendTarget: boolean): Promise<void> {
    const failedOutcome =
      this.store.snapshot.sendOutcome?.kind === "connect_failed"
        ? this.store.snapshot.sendOutcome
        : null;
    const targetId =
      failedOutcome?.targetDeviceId ??
      this.store.snapshot.selectedSendTargetId ??
      this.store.snapshot.reconnectPrefs.lastActiveDeviceId;
    const reason = failedOutcome?.connectFailureReason;
    if (reason === "permission_unavailable" || !targetId || !this.client.hasLiveDevice(targetId)) {
      await this.handleConnect({
        useChooser: true,
        setAsSendTarget,
        explicitUserAction: true,
      });
      return;
    }
    await this.handleConnect({
      useChooser: false,
      targetDeviceId: targetId,
      setAsSendTarget,
      explicitUserAction: true,
    });
  }

  /**
   * Connects to either a saved permitted badge OR opens Web Bluetooth chooser.
   * Preserves any existing live session seamlessly if the user cancels the picker!
   */
  private async handleConnect(options: {
    readonly useChooser: boolean;
    readonly targetDeviceId?: string;
    readonly setAsSendTarget: boolean;
    readonly explicitUserAction?: boolean;
    readonly isAutoReconnectAttempt?: boolean;
  }): Promise<boolean> {
    const res = await this.handleConnectDetailed(options);
    return res.connected;
  }

  /**
   * Executes one Web Bluetooth connection attempt returning both success and categorized failure cause.
   */
  private async handleConnectDetailed(options: {
    readonly useChooser: boolean;
    readonly targetDeviceId?: string;
    readonly setAsSendTarget: boolean;
    readonly explicitUserAction?: boolean;
    readonly isAutoReconnectAttempt?: boolean;
  }): Promise<{
    /** Whether the Bluetooth GATT session and Lqm2.r handshake succeeded. */
    readonly connected: boolean;
    /** Categorized failure reason recorded when `connected` is `false`. */
    readonly failureReason?: Bg02ConnectFailureReason;
  }> {
    if (!this.webBluetoothAvailable) {
      return { connected: false, failureReason: "unsupported" };
    }

    if (!options.isAutoReconnectAttempt) {
      this.cancelAutoReconnect();
    }
    const attemptSeq = ++this.connectAttemptSeq;
    const wasConnectedBefore = this.client.isConnected;
    const prevMetadata = this.store.snapshot.metadata;
    const prevActiveId = this.client.activeId;

    const activePrepare = this.store.snapshot.preparingSend;
    const prepareAbortedByThisConnect = activePrepare !== null;
    if (prepareAbortedByThisConnect) {
      this.prepareSequence += 1;
    }

    const prevOutcome = this.store.snapshot.sendOutcome;
    const nextOutcomeOnStart: SendOutcomeState | null = prepareAbortedByThisConnect
      ? {
          kind: "prepare_aborted",
          targetDeviceId: activePrepare.targetDeviceId,
          targetDeviceName: activePrepare.targetDeviceName,
          message: this.i18n.t.send.statePrepareAbortedTitle,
        }
      : prevOutcome?.kind === "connect_failed"
        ? null
        : prevOutcome;

    this.store.patchState({
      preparingSend: null,
      connectionStatus: "connecting",
      pendingConnectDeviceId: options.useChooser ? null : (options.targetDeviceId ?? null),
      sendOutcome: nextOutcomeOnStart,
      actionErrorBanner: null,
    });

    try {
      const baseMetadata = await this.client.connect({
        reuseDevice: !options.useChooser,
        deviceId: options.targetDeviceId,
        acceptAllDevices: this.store.snapshot.acceptAllDevices,
        preferWriteWithoutResponse: this.store.snapshot.preferWriteWithoutResponse,
      });

      // Discard stale attempt if superseded or if device was deleted meanwhile
      if (attemptSeq !== this.connectAttemptSeq) {
        return { connected: false };
      }

      let nextDeletedIds = this.store.snapshot.deletedDeviceIds;
      if (options.useChooser && nextDeletedIds.includes(baseMetadata.deviceId)) {
        nextDeletedIds = clearDeletedDeviceId(nextDeletedIds, baseMetadata.deviceId);
        saveDeletedDeviceIds(nextDeletedIds);
      } else if (nextDeletedIds.includes(baseMetadata.deviceId)) {
        await this.client.disconnect();
        this.store.patchState({
          connectionStatus: "disconnected",
          pendingConnectDeviceId: null,
          activeDeviceId: null,
          metadata: null,
        });
        return { connected: false };
      }

      const fullMeta = await this.queryDeviceTelemetry(baseMetadata, false);
      if (attemptSeq !== this.connectAttemptSeq) {
        return { connected: false };
      }

      const updatedProfiles = upsertDeviceProfile(this.store.snapshot.savedDevices, {
        id: fullMeta.deviceId,
        advertisedName: fullMeta.deviceName ?? "BG02",
        batteryPercent: fullMeta.standardInfo?.batteryPercent,
        firmwareRevision: fullMeta.standardInfo?.firmwareRevision,
        displaySpec: fullMeta.dialInfo
          ? `${fullMeta.dialInfo.width}×${fullMeta.dialInfo.height}`
          : undefined,
        freeStorageBytes: fullMeta.freeStorageBytes,
        connectedAtMs: Date.now(),
      });
      saveDeviceProfiles(updatedProfiles);

      const nextPrefs = {
        ...this.store.snapshot.reconnectPrefs,
        lastActiveDeviceId: fullMeta.deviceId,
      };
      saveReconnectPrefs(nextPrefs);

      const liveIds = await this.client.refreshPermittedDevices(new Set(nextDeletedIds));

      const shouldUpdateSendTarget =
        options.setAsSendTarget || this.store.snapshot.selectedSendTargetId === null;
      const keepOutcome =
        this.store.snapshot.sendOutcome?.kind === "prepare_aborted"
          ? this.store.snapshot.sendOutcome
          : null;

      this.store.patchState({
        connectionStatus: "connected",
        reconnectStatus: null,
        pendingConnectDeviceId: null,
        activeDeviceId: fullMeta.deviceId,
        canReconnect: this.client.hasLiveDevice(fullMeta.deviceId),
        metadata: fullMeta,
        savedDevices: updatedProfiles,
        deletedDeviceIds: nextDeletedIds,
        liveDeviceIds: liveIds,
        reconnectPrefs: nextPrefs,
        detailDeviceId: this.store.snapshot.detailDeviceId ?? fullMeta.deviceId,
        selectedSendTargetId: shouldUpdateSendTarget
          ? fullMeta.deviceId
          : this.store.snapshot.selectedSendTargetId,
        targetDriftNotice: shouldUpdateSendTarget ? false : this.store.snapshot.targetDriftNotice,
        sendOutcome: keepOutcome,
      });

      this.announceStatus(fullMeta.deviceName ?? "BG02");
      return { connected: true };
    } catch (err) {
      if (attemptSeq !== this.connectAttemptSeq) {
        return { connected: false };
      }

      const isPickerCancel =
        err instanceof Error &&
        (err.name === "NotFoundError" || err.name === "AbortError");

      // Preserve prior live session when picker dialog is dismissed without choosing
      if (isPickerCancel && wasConnectedBefore && this.client.isConnected && prevActiveId) {
        this.store.patchState({
          connectionStatus: "connected",
          pendingConnectDeviceId: null,
          activeDeviceId: prevActiveId,
          metadata: prevMetadata,
        });
        return { connected: false };
      }

      const failureReason: Bg02ConnectFailureReason =
        err instanceof Bg02ConnectError
          ? err.reason
          : /no live bluetooth handle|permission|not authorized/i.test(
                err instanceof Error ? err.message : String(err)
              )
            ? "permission_unavailable"
            : "gatt_failed";

      const stillConnected = this.client.isConnected && Boolean(this.client.activeId);
      let nextOutcome = this.store.snapshot.sendOutcome;
      if (!isPickerCancel && !options.isAutoReconnectAttempt && options.explicitUserAction) {
        const targetId =
          options.targetDeviceId ??
          (err instanceof Bg02ConnectError ? err.deviceId : undefined) ??
          this.store.snapshot.selectedSendTargetId ??
          this.store.snapshot.detailDeviceId ??
          null;
        const targetProfile = targetId
          ? this.store.snapshot.savedDevices.find((d) => d.id === targetId)
          : undefined;
        const errorDevName = err instanceof Bg02ConnectError ? err.deviceName : undefined;
        const targetName =
          targetProfile?.nickname ??
          (errorDevName && errorDevName.trim() ? errorDevName.trim() : "BG02");
        nextOutcome = {
          kind: "connect_failed",
          targetDeviceId: targetId,
          targetDeviceName: targetName,
          message:
            failureReason === "permission_unavailable"
              ? this.i18n.t.send.connectPermissionUnavailableBody
              : this.i18n.t.send.connectGattFailedBody,
          connectFailureReason: failureReason,
        };
      }
      this.store.patchState({
        connectionStatus: stillConnected ? "connected" : "disconnected",
        pendingConnectDeviceId: null,
        activeDeviceId: stillConnected ? this.client.activeId : null,
        metadata: stillConnected ? prevMetadata : null,
        sendOutcome: nextOutcome,
      });

      if (!isPickerCancel) {
        this.store.appendLog("warn", `Connect failed: ${formatErrorForUser(err, this.i18n.t)}`);
      }
      return { connected: false, failureReason };
    }
  }

  /** Manually disconnects the active badge and halts automatic reconnection. */
  private async handleDisconnect(): Promise<void> {
    this.invalidatePendingPrepare(true);
    this.cancelAutoReconnect();
    this.connectAttemptSeq += 1;
    await this.client.disconnect();
    this.store.patchState({
      connectionStatus: "disconnected",
      activeDeviceId: null,
      metadata: null,
      pendingConnectDeviceId: null,
      sendOutcome:
        this.store.snapshot.sendOutcome?.kind === "connect_failed"
          ? null
          : this.store.snapshot.sendOutcome,
    });
  }

  /** Persists an updated custom nickname for a saved badge profile. */
  private handleRenameSavedDevice(deviceId: string, nextNickname: string): void {
    const updated = renameDeviceProfile(
      this.store.snapshot.savedDevices,
      deviceId,
      nextNickname
    );
    saveDeviceProfiles(updated);
    this.store.patchState({ savedDevices: updated });
  }

  /** Unregisters a badge, records its deleted tombstone, and revokes browser permission if supported. */
  private async handleForgetSavedDevice(deviceId: string): Promise<void> {
    this.cancelAutoReconnect();
    this.connectAttemptSeq += 1;
    const existing = this.store.snapshot.savedDevices.find((d) => d.id === deviceId);
    const displayName = existing?.nickname ?? "BG02";

    if (this.client.activeId === deviceId) {
      await this.client.disconnect();
    }

    const browserPermissionRevoked = await this.client.forgetCachedDevice(deviceId);
    const nextDeletedIds = addDeletedDeviceId(this.store.snapshot.deletedDeviceIds, deviceId);
    saveDeletedDeviceIds(nextDeletedIds);

    const nextSaved = removeDeviceProfile(this.store.snapshot.savedDevices, deviceId);
    saveDeviceProfiles(nextSaved);

    const prefs = this.store.snapshot.reconnectPrefs;
    const nextPrefs =
      prefs.lastActiveDeviceId === deviceId
        ? { ...prefs, lastActiveDeviceId: nextSaved[0]?.id ?? null }
        : prefs;
    saveReconnectPrefs(nextPrefs);

    const liveIds = await this.client.refreshPermittedDevices(new Set(nextDeletedIds));
    const currentSelected = this.store.snapshot.selectedSendTargetId;
    const activeClientId = this.client.activeId;
    const prevOutcome = this.store.snapshot.sendOutcome;

    this.store.patchState({
      savedDevices: nextSaved,
      deletedDeviceIds: nextDeletedIds,
      liveDeviceIds: liveIds,
      reconnectPrefs: nextPrefs,
      detailDeviceId: null,
      selectedSendTargetId: currentSelected === deviceId ? null : currentSelected,
      pendingConnectDeviceId:
        this.store.snapshot.pendingConnectDeviceId === deviceId
          ? null
          : this.store.snapshot.pendingConnectDeviceId,
      sendOutcome: prevOutcome?.targetDeviceId === deviceId ? null : prevOutcome,
      connectionStatus: this.client.isConnected ? "connected" : "disconnected",
      activeDeviceId: activeClientId,
      metadata: activeClientId ? this.store.snapshot.metadata : null,
      detailForgetNotice: {
        deviceId,
        deviceName: displayName,
        browserPermissionRevoked,
      },
    });
  }

  /** Updates and persists auto-reconnect and startup-connect preferences. */
  private handleUpdateReconnectPrefs(
    patch: Partial<{ autoRetryOnDrop: boolean; autoConnectOnStartup: boolean }>
  ): void {
    const nextPrefs = { ...this.store.snapshot.reconnectPrefs, ...patch };
    saveReconnectPrefs(nextPrefs);
    this.store.patchState({ reconnectPrefs: nextPrefs });
  }

  /** Starts the 30-second periodic battery and storage telemetry polling timer. */
  private startTelemetryPoller(): void {
    if (this.telemetryPollTimer !== null) {
      clearInterval(this.telemetryPollTimer);
    }
    this.telemetryPollTimer = setInterval(() => {
      if (this.client.isConnected && !this.uploadInFlight && this.store.snapshot.metadata) {
        void this.queryDeviceTelemetry(this.store.snapshot.metadata, true);
      }
    }, TELEMETRY_POLL_INTERVAL_MS);
  }

  /** Triggers an immediate manual telemetry refresh for the connected badge. */
  private async handleRefreshTelemetry(): Promise<void> {
    const meta = this.store.snapshot.metadata;
    if (!this.client.isConnected || !meta) {
      return;
    }
    const updated = await this.queryDeviceTelemetry(meta, false);
    this.store.patchState({ metadata: updated });
  }

  /** Queries dial geometry, battery, and free storage over BLE and updates saved snapshots. */
  private async queryDeviceTelemetry(
    baseMetadata: ConnectedDeviceMetadata,
    isBackgroundPoll: boolean
  ): Promise<ConnectedDeviceMetadata> {
    const prevGeom = resolveTargetGeometry(baseMetadata.dialInfo);
    let dialInfo: ClockDialInfo | null = baseMetadata.dialInfo;
    let freeStorageBytes: number | null = baseMetadata.freeStorageBytes;
    let freeStorageError: string | null = null;
    let standardInfo: StandardDeviceInfo | null = baseMetadata.standardInfo;

    try {
      if (!isBackgroundPoll || !dialInfo) {
        dialInfo = await this.client.getDialInfo();
      }
    } catch {
      // Keep nullable when firmware omits 0x20/0x02 response
    }

    try {
      freeStorageBytes = await this.client.getFreeStorage();
    } catch (err) {
      freeStorageBytes = null;
      freeStorageError = formatErrorForUser(err, this.i18n.t);
    }

    try {
      const nextStd = await this.client.readStandardInfo();
      standardInfo = {
        batteryPercent: nextStd.batteryPercent ?? standardInfo?.batteryPercent,
        manufacturer: nextStd.manufacturer ?? standardInfo?.manufacturer,
        model: nextStd.model ?? standardInfo?.model,
        firmwareRevision: nextStd.firmwareRevision ?? standardInfo?.firmwareRevision,
        hardwareRevision: nextStd.hardwareRevision ?? standardInfo?.hardwareRevision,
        softwareRevision: nextStd.softwareRevision ?? standardInfo?.softwareRevision,
      };
    } catch {
      // Optional DIS/Battery services missing
    }

    const updatedMeta: ConnectedDeviceMetadata = {
      ...baseMetadata,
      dialInfo,
      freeStorageBytes,
      freeStorageError,
      standardInfo,
    };

    const nextSaved = upsertDeviceProfile(this.store.snapshot.savedDevices, {
      id: updatedMeta.deviceId,
      advertisedName: updatedMeta.deviceName ?? "BG02",
      batteryPercent: updatedMeta.standardInfo?.batteryPercent,
      firmwareRevision: updatedMeta.standardInfo?.firmwareRevision,
      displaySpec: updatedMeta.dialInfo
        ? `${updatedMeta.dialInfo.width}×${updatedMeta.dialInfo.height}`
        : undefined,
      freeStorageBytes: updatedMeta.freeStorageBytes,
      connectedAtMs: Date.now(),
    });
    saveDeviceProfiles(nextSaved);

    const nextGeom = resolveTargetGeometry(dialInfo);
    const geometryChanged =
      nextGeom.width !== prevGeom.width ||
      nextGeom.height !== prevGeom.height ||
      nextGeom.shape !== prevGeom.shape;

    if (this.client.activeId === baseMetadata.deviceId) {
      this.store.patchState({
        metadata: updatedMeta,
        savedDevices: nextSaved,
      });
    }

    if (!isBackgroundPoll || geometryChanged) {
      this.schedulePreviewAndEncode();
    }
    return updatedMeta;
  }

  /** Decodes a selected local image file into the editor draft while preserving prior state on failure. */
  private async handleSelectImageFile(file: File): Promise<void> {
    this.cancelSampleLoad();
    this.invalidatePendingProceedToSend();
    const hadContentBefore =
      Boolean(this.loadedImage) || Boolean(this.store.snapshot.textOverlay.enabled && this.store.snapshot.textOverlay.text.trim());

    this.store.patchState({ isLoadingImage: true, imageLoadError: null });

    try {
      const loadedImg = await loadLocalImageFile(file);
      this.loadedImage = loadedImg;
      this.selectDisplayedBadgeForDraft();

      const geom = resolveTargetGeometry(this.store.snapshot.metadata?.dialInfo);
      const cover = computeCoverScale(
        loadedImg.naturalWidth,
        loadedImg.naturalHeight,
        geom.width,
        geom.height
      );
      void cover;

      this.store.setSourceMeta(
        {
          fileName: file.name,
          naturalWidth: loadedImg.naturalWidth,
          naturalHeight: loadedImg.naturalHeight,
        },
        {
          offsetX: 0,
          offsetY: 0,
          scale: 1,
          rotationDeg: 0,
          backgroundColor: this.store.snapshot.transform.backgroundColor,
        }
      );

      await this.composeFreshOutput();
      if (this.store.snapshot.activeScreen === "home") {
        this.navigateTo("editor", { direction: "forward" });
      }
    } catch {
      // Preserve existing loaded image & draft cleanly on corrupted file
      const h = this.i18n.t.home;
      this.store.patchState({
        isLoadingImage: false,
        imageLoadError: hadContentBefore ? h.imageLoadErrorKeepDraft : h.imageLoadErrorEmpty,
      });
    }
  }

  /** Starts a new draft from Home with the badge shown there as its initial recipient. */
  private selectDisplayedBadgeForDraft(): void {
    const state = this.store.snapshot;
    if (state.activeScreen === "home" && state.connectionStatus === "connected" && state.metadata) {
      this.store.patchState({
        selectedSendTargetId: state.metadata.deviceId,
        sendOutcome: null,
        targetDriftNotice: false,
      });
    }
  }

  /** Cancels a bundled-photo load when the user leaves Home or selects a local file. */
  private cancelSampleLoad(): void {
    if (!this.sampleLoad) return;
    this.sampleLoad.abort();
    this.sampleLoad = null;
    this.store.patchState({ isLoadingImage: false });
  }

  /** Loads the built-in example through the same composition flow as a local file. */
  private async handleTrySample(): Promise<void> {
    if (this.store.snapshot.isLoadingImage) return;
    const pending = new AbortController();
    this.sampleLoad = pending;
    this.store.patchState({ isLoadingImage: true, imageLoadError: null });
    try {
      const response = await fetch(SAMPLE_PHOTO_URL, { signal: pending.signal });
      if (!response.ok) throw new Error("Could not open the bundled photo");
      const blob = await response.blob();
      if (this.sampleLoad !== pending) return;
      this.sampleLoad = null;
      await this.handleSelectImageFile(new File([blob], "sample-fuji.jpg", { type: "image/jpeg" }));
    } catch {
      if (this.sampleLoad !== pending) return;
      this.sampleLoad = null;
      this.store.patchState({ isLoadingImage: false, imageLoadError: this.i18n.t.home.imageLoadErrorEmpty });
    }
  }

  /** Redraws both the hidden export canvas and the circular preview canvas synchronously. */
  private syncCanvasAndPreviewOnly(): void {
    const snap = this.store.snapshot;
    const geometry = resolveTargetGeometry(snap.metadata?.dialInfo);
    renderExportComposition(
      this.offscreenExportCanvas,
      this.loadedImage,
      snap.transform,
      snap.textOverlay,
      geometry
    );
    renderPreviewWithGuides(
      this.badgeEditor.previewCanvas,
      this.offscreenExportCanvas,
      geometry.shape
    );
  }

  /** Schedules debounced JPEG encoding after canvas transform or text edits. */
  private schedulePreviewAndEncode(): void {
    this.syncCanvasAndPreviewOnly();
    if (this.encodeTimer !== null) {
      clearTimeout(this.encodeTimer);
      this.encodeTimer = null;
    }

    this.store.patchState({ isEncodingDraft: true });
    const token = ++this.encodeSequence;

    this.encodeTimer = setTimeout(() => {
      this.encodeTimer = null;
      void (async () => {
        const snap = this.store.snapshot;
        const latestGeometry = resolveTargetGeometry(snap.metadata?.dialInfo);
        try {
          const result = await this.composeAndEncode(
            this.loadedImage,
            snap.transform,
            snap.textOverlay,
            snap.encoding,
            latestGeometry,
            undefined,
            snap.draftGeneration
          );
          if (token !== this.encodeSequence) {
            return;
          }
          this.store.patchState({
            latestOutput: result,
            isEncodingDraft: false,
          });
          this.homePanel.render(
            this.store.snapshot,
            this.offscreenExportCanvas,
            this.webBluetoothAvailable
          );
          this.sendPanel.render(
            this.store.snapshot,
            this.offscreenExportCanvas,
            this.webBluetoothAvailable
          );
        } catch {
          if (token === this.encodeSequence) {
            this.store.patchState({ isEncodingDraft: false });
          }
        }
      })();
    }, ENCODE_DEBOUNCE_MS);
  }

  /** Immediately renders and encodes the current badge draft into baseline JPEG bytes. */
  private async composeFreshOutput(): Promise<CompositedBadgeResult> {
    if (this.encodeTimer !== null) {
      clearTimeout(this.encodeTimer);
      this.encodeTimer = null;
    }
    const token = ++this.encodeSequence;
    const snap = this.store.snapshot;
    const geometry = resolveTargetGeometry(snap.metadata?.dialInfo);
    this.syncCanvasAndPreviewOnly();

    const result = await this.composeAndEncode(
      this.loadedImage,
      snap.transform,
      snap.textOverlay,
      snap.encoding,
      geometry,
      undefined,
      snap.draftGeneration
    );
    if (token === this.encodeSequence) {
      this.store.patchState({ latestOutput: result, isEncodingDraft: false });
    }
    return result;
  }

  /** Finalizes encoding and transitions from Editor (Screen 2) to Send (Screen 3) unless left meanwhile. */
  private async handleProceedToSend(): Promise<void> {
    const mySeq = ++this.proceedToSendSeq;
    this.store.patchState({ isEncodingDraft: true });
    try {
      await this.composeFreshOutput();
    } finally {
      if (this.store.snapshot.isEncodingDraft) {
        this.store.patchState({ isEncodingDraft: false });
      }
    }
    if (
      !shouldCommitEditorProceedToSend({
        expectedSeq: mySeq,
        currentSeq: this.proceedToSendSeq,
        activeScreen: this.store.snapshot.activeScreen,
      })
    ) {
      return;
    }
    this.store.patchState({ sendOutcome: null, targetDriftNotice: false });
    this.navigateTo("send", { direction: "forward" });
  }

  /** Triggers a browser download of the freshly encoded badge JPEG file. */
  private async handleDownloadJpeg(): Promise<void> {
    const out = await this.composeFreshOutput();
    const copy = new Uint8Array(out.jpegBytes.byteLength);
    copy.set(out.jpegBytes);
    const blob = new Blob([copy], { type: "image/jpeg" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = DEFAULT_EXPORT_FILENAME;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Runs preflight validation, freezes the upload session, and starts BLE image transfer. */
  private async handleSendNow(): Promise<void> {
    if (this.uploadInFlight || this.store.snapshot.preparingSend) {
      return;
    }

    const initialState = this.store.snapshot;
    const initialTargetView = resolveSendTargetView({
      selectedSendTargetId: initialState.selectedSendTargetId,
      savedDevices: initialState.savedDevices,
      clientConnected:
        this.client.isConnected && initialState.connectionStatus === "connected",
      clientActiveId: this.client.activeId,
      connectedMetadata: initialState.metadata,
    });
    if (!initialTargetView.isTargetConnected || !initialTargetView.targetDeviceId) {
      return;
    }

    const myPrepareToken = ++this.prepareSequence;
    const pendingPrepare: PendingPrepareTarget = {
      targetDeviceId: initialTargetView.targetDeviceId,
      targetDeviceName: initialTargetView.targetDisplayName ?? "BG02",
      draftGeneration: initialState.draftGeneration,
      bleSessionGeneration: this.client.currentSessionGeneration,
      prepareToken: myPrepareToken,
    };
    this.store.patchState({
      preparingSend: pendingPrepare,
      sendOutcome: null,
      frozenRetrySession: null,
    });

    let freshOut: CompositedBadgeResult;
    try {
      freshOut = await this.composeFreshOutput();
    } catch (err) {
      const currentPrepare = this.store.snapshot.preparingSend as PendingPrepareTarget | null;
      if (currentPrepare?.prepareToken === myPrepareToken) {
        this.store.patchState({ preparingSend: null });
      }
      throw err;
    }

    const state = this.store.snapshot;
    const consistency = verifyPreparedSendConsistency({
      pending: pendingPrepare,
      currentPrepareToken: this.prepareSequence,
      activeScreen: state.activeScreen,
      currentDraftGeneration: state.draftGeneration,
      currentSelectedTargetId: state.selectedSendTargetId,
      liveActiveDeviceId: this.client.activeId,
      isBleConnected: this.client.isConnected && state.connectionStatus === "connected",
      currentBleSessionGeneration: this.client.currentSessionGeneration,
    });
    if (!consistency.ok) {
      if (consistency.reason !== "superseded" && consistency.reason !== "screen_left") {
        this.store.patchState({
          preparingSend: null,
          sendOutcome: {
            kind: "prepare_aborted",
            targetDeviceId: state.selectedSendTargetId ?? pendingPrepare.targetDeviceId,
            targetDeviceName: pendingPrepare.targetDeviceName,
            message: this.i18n.t.send.statePrepareAbortedTitle,
          },
        });
      } else if (state.preparingSend?.prepareToken === myPrepareToken) {
        this.store.patchState({ preparingSend: null });
      }
      return;
    }
    this.store.patchState({ preparingSend: null });

    const targetView = resolveSendTargetView({
      selectedSendTargetId: state.selectedSendTargetId,
      savedDevices: state.savedDevices,
      clientConnected: this.client.isConnected && state.connectionStatus === "connected",
      clientActiveId: this.client.activeId,
      connectedMetadata: state.metadata,
    });

    const gate = evaluateUploadGate({
      hasSourceImage: Boolean(this.loadedImage),
      textOverlay: state.textOverlay,
      targetView,
      latestOutput: freshOut,
      draftGeneration: state.draftGeneration,
    });

    if (!gate.allowed) {
      const targetName = targetView.targetDisplayName ?? "BG02";
      let outcome: SendOutcomeState | null = null;
      const s = this.i18n.t.send;
      if (gate.reason === "low_battery_preflight") {
        outcome = {
          kind: "device_refusal",
          targetDeviceId: targetView.targetDeviceId,
          targetDeviceName: targetName,
          message: s.refusalBatteryTitle,
          errorKey: "lowBattery",
        };
      } else if (gate.reason === "storage_full_preflight") {
        outcome = {
          kind: "device_refusal",
          targetDeviceId: targetView.targetDeviceId,
          targetDeviceName: targetName,
          message: s.refusalStorageTitle,
          errorKey: "storageFull",
        };
      } else if (
        gate.reason === "unsupported_algorithm" ||
        gate.reason === "unverified_device" ||
        gate.reason === "invalid_dimensions"
      ) {
        outcome = {
          kind: "unsupported",
          targetDeviceId: targetView.targetDeviceId,
          targetDeviceName: targetName,
          message: s.unsupportedDeviceTitle,
          unsupportedReason:
            gate.reason === "unsupported_algorithm"
              ? "unsupported_algorithm"
              : "unverified_device",
          algorithm: targetView.liveMetadata?.dialInfo?.algorithm ?? null,
        };
      }
      if (outcome) {
        this.store.patchState({ sendOutcome: outcome });
      }
      return;
    }

    this.store.patchState({
      frozenRetrySession: gate.frozenSession,
      sendOutcome: null,
    });
    await this.executeFrozenUpload(gate.frozenSession);
  }

  /** Retries transmission using the byte-identical frozen JPEG session from the prior attempt. */
  private async handleRetryFrozenUpload(): Promise<void> {
    if (this.uploadInFlight) {
      return;
    }
    const frozen = this.store.snapshot.frozenRetrySession;
    if (!frozen) {
      await this.handleSendNow();
      return;
    }
    this.store.patchState({ sendOutcome: null });
    await this.executeFrozenUpload(frozen);
  }

  /** Executes chunked BLE image upload with auto-retry and ACK verification. */
  private async executeFrozenUpload(frozen: FrozenUploadSession): Promise<void> {
    this.uploadInFlight = true;
    const dict = this.i18n.t;
    const s = dict.send;

    try {
      const totalAttempts = 1 + UPLOAD_MAX_AUTO_RETRIES;

      for (let attempt = 1; attempt <= totalAttempts; attempt++) {
        const plan = resolveUploadReconnectPlan({
          activeDeviceId: frozen.targetDeviceId,
          clientActiveId: this.client.activeId,
          canReconnect: this.client.canReconnect,
          savedDevices: this.store.snapshot.savedDevices,
          liveDeviceIds: this.store.snapshot.liveDeviceIds,
          prefs: this.store.snapshot.reconnectPrefs,
          deletedDeviceIds: new Set(this.store.snapshot.deletedDeviceIds),
        });

        // Guarantee live connection points ONLY to `frozen.targetDeviceId`
        if (!this.client.isConnected || this.client.activeId !== frozen.targetDeviceId) {
          const targetToConnect = plan.targetDeviceId ?? frozen.targetDeviceId;
          const ok = await this.handleConnect({
            useChooser: false,
            targetDeviceId: targetToConnect,
            setAsSendTarget: true,
          });
          if (!ok || this.client.activeId !== frozen.targetDeviceId) {
            this.store.patchState({
              uploadProgress: null,
              sendOutcome: {
                kind: "disconnect_or_timeout",
                targetDeviceId: frozen.targetDeviceId,
                targetDeviceName: frozen.targetDeviceName,
                message: interpolate(s.stateLinkDroppedTitle, {
                  name: frozen.targetDeviceName,
                }),
                isFinishTimeout: false,
              },
            });
            return;
          }
        }

        const liveMeta = this.store.snapshot.metadata;
        const support = assessDeviceUploadSupport(liveMeta);
        if (!support.supported) {
          this.store.patchState({
            uploadProgress: null,
            sendOutcome: {
              kind: "unsupported",
              targetDeviceId: frozen.targetDeviceId,
              targetDeviceName: frozen.targetDeviceName,
              message: s.unsupportedDeviceTitle,
              unsupportedReason:
                support.reason === "unsupported_algorithm"
                  ? "unsupported_algorithm"
                  : "unverified_device",
              algorithm: support.algorithm ?? null,
            },
          });
          return;
        }

        try {
          const startMs = performance.now();
          const result = await this.client.uploadDialImage(frozen.jpegBytes, {
            expectedDeviceId: frozen.targetDeviceId,
            onProgress: (progress) => {
              this.store.patchState({ uploadProgress: progress });
            },
          });

          const durationSec = ((performance.now() - startMs) / 1000).toFixed(1);
          const checksumHex = `0x${byteSum32(frozen.jpegBytes)
            .toString(16)
            .toUpperCase()
            .padStart(8, "0")}`;

          this.store.patchState({
            uploadProgress: null,
            sendOutcome: {
              kind: "completed",
              targetDeviceId: result.deviceId,
              targetDeviceName: frozen.targetDeviceName,
              message: interpolate(s.stateCompletedTitle, { name: frozen.targetDeviceName }),
              byteLength: result.imageBytes,
              checksumHex,
              durationSec,
            },
            lastCompletedTransfer: {
              targetDeviceId: result.deviceId,
              targetDeviceName: frozen.targetDeviceName,
              checksumHex,
              byteLength: result.imageBytes,
              durationSec,
              completedAtIso: new Date().toISOString(),
            },
          });
          this.announceStatus(
            interpolate(s.stateCompletedTitle, { name: frozen.targetDeviceName })
          );
          await this.handleRefreshTelemetry();
          return;
        } catch (err) {
          if (err instanceof Bg02ProtocolError) {
            this.store.patchState({
              uploadProgress: null,
              sendOutcome: {
                kind: "device_refusal",
                targetDeviceId: frozen.targetDeviceId,
                targetDeviceName: frozen.targetDeviceName,
                message: formatErrorForUser(err, dict),
                errorKey: err.errorKey,
              },
            });
            return;
          }

          if (attempt < totalAttempts && isRetryableUploadError(err)) {
            this.store.patchState({
              reconnectStatus: {
                attempt,
                maxAttempts: UPLOAD_MAX_AUTO_RETRIES,
                targetDeviceId: frozen.targetDeviceId,
              },
            });
            await new Promise((r) => setTimeout(r, UPLOAD_RETRY_SETTLE_DELAY_MS));
            this.store.patchState({ reconnectStatus: null });
            continue;
          }

          const errMsg = err instanceof Error ? err.message : String(err);
          const isFinishTimeout =
            errMsg.includes("DIAL_FINISH") || errMsg.toLowerCase().includes("finish");

          this.store.patchState({
            uploadProgress: null,
            reconnectStatus: null,
            sendOutcome: {
              kind: "disconnect_or_timeout",
              targetDeviceId: frozen.targetDeviceId,
              targetDeviceName: frozen.targetDeviceName,
              message: isFinishTimeout
                ? s.stateTimeoutTitle
                : interpolate(s.stateLinkDroppedTitle, { name: frozen.targetDeviceName }),
              isFinishTimeout,
            },
          });
          return;
        }
      }
    } finally {
      this.uploadInFlight = false;
      this.store.patchState({ uploadProgress: null, reconnectStatus: null });
    }
  }

  /** Copies text to the system clipboard and announces confirmation to screen readers. */
  private async copyTextToClipboard(text: string, announcement: string): Promise<void> {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        this.announceStatus(announcement);
      }
    } catch {
      // Clipboard denied silently in restricted iframe
    }
  }

  /** Serializes communication logs into plain text and copies them to the clipboard. */
  private async handleCopyLogs(): Promise<void> {
    const lines = this.store.snapshot.logs
      .map((e) => `[${e.timestamp}] ${e.level.toUpperCase()} ${e.message}`)
      .join("\n");
    await this.copyTextToClipboard(lines, this.i18n.t.logs.copiedToast);
  }

  /** Registers the production Service Worker and tracks scoped offline cache readiness. */
  private registerServiceWorker(): void {
    if (
      !import.meta.env.PROD ||
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    const updateReadyStatus = async (reg: ServiceWorkerRegistration): Promise<void> => {
      const ready = await verifyScopedServiceWorkerReady(
        reg,
        typeof window !== "undefined" ? window.caches : undefined,
        Boolean(navigator.serviceWorker.controller)
      );
      this.store.patchState({ serviceWorkerActive: ready });
    };

    navigator.serviceWorker
      .register("./sw.js")
      .then((registration) => {
        void updateReadyStatus(registration);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "activated") {
              void updateReadyStatus(registration);
            }
          });
        });
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          void updateReadyStatus(registration);
        });
      })
      .catch(() => {
        this.store.patchState({ serviceWorkerActive: false });
      });
  }
}

if (typeof document !== "undefined" && document.querySelector("#app")) {
  const mount = (): void => {
    const root = document.querySelector<HTMLElement>("#app");
    if (root) {
      const app = new Bg02StudioApp(root);
      const splash = document.querySelector<HTMLElement>("#startup");
      afterSplash(() => {
        if (splash) splash.hidden = true;
        root.hidden = false;
        const dialog = document.querySelector<HTMLDialogElement>("#first-run-guide");
        if (dialog) app.enableFirstRunGuide(dialog);
      });
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
}
