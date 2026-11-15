/**
 * @module main
 * Application bootstrap wiring localization (`ja`/`en`), unidirectional state management,
 * the BG02 Web Bluetooth client, interactive 240×240 circular image composer, and offline PWA registration.
 */

import "./ui/styles.css";
import { Bg02Client } from "./ble/bg02Client";
import {
  isRetryableUploadError,
  type ClockDialInfo,
  type ConnectedDeviceMetadata,
  type StandardDeviceInfo,
  type UploadDialResult,
  type UploadProgress,
} from "./ble/types";
import {
  DEFAULT_DISPLAY_SIZE_PX,
  TELEMETRY_POLL_INTERVAL_MS,
  UPLOAD_MAX_AUTO_RETRIES,
  UPLOAD_RETRY_SETTLE_DELAY_MS,
} from "./constants/ble";
import { formatErrorForUser, I18nService, interpolate } from "./i18n/i18n";
import type { LocaleCode, TranslationSchema } from "./i18n/types";
import {
  clampRelativeScale,
  composeAndEncodeBadge,
  computeContainRelativeScale,
  createDefaultTransform,
  loadLocalImageFile,
  normalizeRotationDeg,
  renderExportComposition,
  renderPreviewWithGuides,
} from "./imaging/badgeCompositor";
import { isUploadableJpeg } from "./imaging/jpegInspector";
import type { BadgeTargetGeometry, CompositedBadgeResult } from "./imaging/types";
import { AppStore, type AppScreenId, type AppStateSnapshot } from "./state/appStore";
import {
  pickStartupReconnectTarget,
  removeDeviceProfile,
  renameDeviceProfile,
  resolveUploadReconnectPlan,
  saveDeviceProfiles,
  saveReconnectPrefs,
  upsertDeviceProfile,
} from "./state/deviceRegistry";
import { BadgeEditor } from "./ui/badgeEditor";
import { DeviceDetailPanel } from "./ui/deviceDetailPanel";
import { createEl, requireElement } from "./ui/domHelpers";
import { HomePanel } from "./ui/homePanel";
import { createStudioIcon } from "./ui/icons";
import { LogPanel } from "./ui/logPanel";
import {
  applyScreenVisibility,
  focusAfterNavigation,
  resolvePopStateRoute,
  shouldPushHistoryEntry,
} from "./ui/screenRouter";

/** Debounce interval (ms) coalescing continuous drag/slider edits before re-encoding JPEG bytes. */
export const ENCODE_DEBOUNCE_MS = 100;

/** Exponential-like backoff intervals (ms) before each automatic reconnect retry after a drop. */
export const AUTO_RECONNECT_DELAYS_MS: ReadonlyArray<number> = [1200, 2500, 4500];

/** Output filename suggested when saving a composed image locally. */
export const DEFAULT_EXPORT_FILENAME = "bg02-badge-240x240.jpg";

/**
 * Resolves active target dimensions and circular/square shape from queried dial telemetry.
 *
 * @param dialInfo - Decoded `0x20/0x02` response, or `null` before device connection.
 * @returns Effective export canvas geometry (defaults to `240x240` round).
 */
export function resolveTargetGeometry(dialInfo: ClockDialInfo | null | undefined): BadgeTargetGeometry {
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
    shape: dialInfo.shape,
  };
}

/**
 * Coordinates lifecycle, UI updates, BLE session telemetry, and debounced JPEG generation.
 */
export class Bg02StudioApp {
  /** Localization service managing `<html lang>` and persistent locale selection. */
  private readonly i18n: I18nService;
  /** Unidirectional reactive application store. */
  private readonly store: AppStore;
  /** Web Bluetooth state-machine client connected to BG02 hardware. */
  private readonly client: Bg02Client;
  /** Screen 1 UI component (Home device list & quick entry). */
  private readonly homePanel: HomePanel;
  /** Screen 2 UI component (circular canvas / transforms / optional text / JPEG upload). */
  private readonly badgeEditor: BadgeEditor;
  /** Screen 3 UI component (detailed device telemetry, unpair guide & developer tools). */
  private readonly deviceDetailPanel: DeviceDetailPanel;
  /** Protocol log panel mounted inside the Device Detail developer disclosure. */
  private readonly logPanel: LogPanel;
  /** Map from screen ID to root panel element for `inert` + visibility routing. */
  private readonly screenPanels: Readonly<Record<AppScreenId, HTMLElement>>;
  /** Home focus element captured before drilling into a sub-screen for smooth focus restoration. */
  private lastHomeTriggerEl: HTMLElement | null = null;
  /** True when the current sub-screen holds a pushed `history.pushState` entry. */
  private hasPushedSubscreenHistory = false;
  /** Periodic background telemetry refresh interval handle (`TELEMETRY_POLL_INTERVAL_MS`). */
  private telemetryPollTimer: ReturnType<typeof setInterval> | null = null;
  /** Prevents overlapping passive 30s telemetry reads when GATT is busy. */
  private isTelemetryQueryInFlight = false;
  /** Offscreen canvas storing clean export pixels free of circular preview guide overlays. */
  private readonly offscreenExportCanvas: HTMLCanvasElement;
  /** Currently decoded local image loaded by the user, or `null`. */
  private loadedImage: HTMLImageElement | null = null;
  /** Monotonic encode token discarding out-of-order async JPEG encoding completions. */
  private encodeSequence = 0;
  /** Pending debounce timer handle for background JPEG optimization. */
  private encodeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Monotonic token invalidating superseded or user-canceled auto-reconnect retry loops. */
  private reconnectRunId = 0;
  /** Pending backoff wait timer during automatic reconnect attempts. */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while `handleUploadToDevice` owns connection recovery and auto-resend transitions. */
  private isUploadWorkflowActive = false;
  /** Main `<h1>` header element. */
  private readonly titleEl: HTMLHeadingElement;
  /** Header subtitle paragraph element. */
  private readonly subtitleEl: HTMLParagraphElement;
  /** Language picker label element. */
  private readonly langLabelEl: HTMLLabelElement;
  /** Language picker `<select>` element. */
  private readonly langSelectEl: HTMLSelectElement;
  /** Offline PWA readiness badge pill shown when Service Worker registers. */
  private readonly offlinePillEl: HTMLSpanElement;
  /** Browser compatibility warning shown when `navigator.bluetooth` is missing. */
  private readonly unsupportedBannerEl: HTMLDivElement;
  /** Action feedback / completion / error banner below header. */
  private readonly feedbackBannerEl: HTMLDivElement;
  /** Footer privacy statement element. */
  private readonly footerPrivacyEl: HTMLParagraphElement;
  /** Non-intrusive screen-reader live region announcing transient outcomes. */
  private readonly politeLiveEl: HTMLDivElement;

  /**
   * Initializes all services, mounts accessible semantic landmarks into `#app`,
   * binds store/locale subscriptions, and triggers initial canvas, BLE permission sync, & SW setup.
   *
   * @param rootContainer - Root DOM mount node (`#app`).
   */
  public constructor(rootContainer: HTMLElement) {
    this.i18n = new I18nService();
    this.store = new AppStore();
    this.client = new Bg02Client((level, msg) => this.store.appendLog(level, msg));
    this.offscreenExportCanvas = document.createElement("canvas");

    this.client.setOnDisconnect((reason, deviceId) => {
      if (this.isUploadWorkflowActive) {
        // 意図: 画像送信・自動再送信ループ実行中の切断では、バックグラウンド再接続と競合しないよう状態通知だけ抑止する。
        this.store.patchState({
          canReconnect: this.client.canReconnect,
          uploadProgress: null,
        });
        return;
      }

      if (reason === "unexpected") {
        this.store.patchState({
          canReconnect: this.client.canReconnect,
          uploadProgress: null,
        });
        if (
          this.store.snapshot.reconnectPrefs.autoRetryOnDrop &&
          this.client.hasLiveDevice(deviceId)
        ) {
          void this.runAutoReconnectLoop(deviceId);
          return;
        }
      }

      this.store.patchState({
        connectionStatus: "disconnected",
        canReconnect: this.client.canReconnect,
        uploadProgress: null,
        reconnectStatus: null,
      });
    });

    const t = this.i18n.t;

    // Header landmark with embossed hardware emblem
    const emblemEl = createEl(
      "div",
      { className: "brand-emblem", attrs: { "aria-hidden": "true" } },
      [createStudioIcon("badge", 24)]
    );
    this.titleEl = createEl("h1", { text: t.header.appTitle });
    this.subtitleEl = createEl("p", { className: "header-subtitle", text: t.header.appSubtitle });
    const brandTextCol = createEl("div", { className: "header-brand" }, [
      this.titleEl,
      this.subtitleEl,
    ]);
    const brandBlock = createEl("div", { className: "header-brand-row" }, [
      emblemEl,
      brandTextCol,
    ]);

    this.offlinePillEl = createEl("span", {
      className: "pill-badge",
      text: t.header.offlineReadyBadge,
      attrs: { "data-tone": "ok", hidden: "" },
    });

    this.langLabelEl = createEl("label", {
      text: t.header.languageLabel,
      attrs: { for: "select-locale" },
    });
    this.langSelectEl = createEl("select", { id: "select-locale" }, [
      createEl("option", { text: "日本語 (JA)", attrs: { value: "ja" } }),
      createEl("option", { text: "English (EN)", attrs: { value: "en" } }),
    ]);
    this.langSelectEl.value = this.i18n.locale;
    this.langSelectEl.addEventListener("change", () => {
      const nextLocale: LocaleCode = this.langSelectEl.value === "ja" ? "ja" : "en";
      this.i18n.setLocale(nextLocale);
    });

    const langPicker = createEl("div", { className: "lang-picker" }, [
      this.langLabelEl,
      this.langSelectEl,
    ]);
    const headerControls = createEl("div", { className: "header-controls" }, [
      this.offlinePillEl,
      langPicker,
    ]);
    const headerEl = createEl("header", { className: "app-header" }, [
      brandBlock,
      headerControls,
    ]);

    const bleSupported = typeof navigator !== "undefined" && Boolean(navigator.bluetooth);
    this.unsupportedBannerEl = createEl("div", {
      className: "banner-alert",
      text: t.header.unsupportedBleBanner,
      attrs: { "data-tone": "err", role: "alert" },
    });
    this.unsupportedBannerEl.hidden = bleSupported;

    this.feedbackBannerEl = createEl("div", {
      className: "banner-alert",
      attrs: { hidden: "", role: "status", "aria-live": "polite" },
    });

    this.politeLiveEl = createEl("div", {
      className: "sr-only",
      attrs: { "aria-live": "polite", "aria-atomic": "true" },
    });

    // Subpanels / Drill-Down Screens (Home <-> Push, Home <-> Device Detail)
    this.logPanel = new LogPanel(t, {
      onCopyLogs: () => {
        void this.handleCopyLogs();
      },
      onClearLogs: () => {
        this.store.clearLogs();
      },
    });

    this.homePanel = new HomePanel(t, {
      onAddOrConnectDevice: () => {
        void this.handleConnect(false);
      },
      onSelectBadgeAndPush: (deviceId) => {
        void this.handleSelectBadgeAndPush(deviceId);
      },
      onOpenDeviceDetail: (deviceId) => {
        const targetId =
          deviceId ??
          this.store.snapshot.activeDeviceId ??
          this.store.snapshot.savedDevices[0]?.id ??
          null;
        this.deviceDetailPanel.clearTransientFeedback();
        this.navigateToScreen("device-detail", { detailDeviceId: targetId });
      },
      onDisconnect: () => {
        void this.handleDisconnect();
      },
      onCancelAutoReconnect: () => {
        this.cancelAutoReconnect();
      },
      onOpenOfflinePush: () => {
        this.navigateToScreen("push");
      },
    });

    this.badgeEditor = new BadgeEditor(t, this.store.snapshot, {
      onBack: () => {
        this.navigateBack();
      },
      onSelectImageFile: (file) => {
        void this.handleSelectImageFile(file);
      },
      onChangeTransform: (patch) => {
        const sanitized = {
          ...patch,
          ...(patch.scale !== undefined ? { scale: clampRelativeScale(patch.scale) } : {}),
          ...(patch.rotationDeg !== undefined
            ? { rotationDeg: normalizeRotationDeg(patch.rotationDeg) }
            : {}),
        };
        this.store.updateTransform(sanitized);
        this.refreshPreviewAndScheduleEncode(false);
      },
      onFitCover: () => {
        this.store.updateTransform({ offsetX: 0, offsetY: 0, scale: 1.0 });
        this.refreshPreviewAndScheduleEncode(true);
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
          : 1.0;
        this.store.updateTransform({ offsetX: 0, offsetY: 0, scale: containScale });
        this.refreshPreviewAndScheduleEncode(true);
      },
      onRotateStep: (deltaDeg) => {
        const nextDeg = normalizeRotationDeg(this.store.snapshot.transform.rotationDeg + deltaDeg);
        this.store.updateTransform({ rotationDeg: nextDeg });
        this.refreshPreviewAndScheduleEncode(true);
      },
      onResetTransform: () => {
        this.store.patchState({ transform: createDefaultTransform(), uploadSuccessBanner: null });
        this.refreshPreviewAndScheduleEncode(true);
      },
      onChangeTextOverlay: (patch) => {
        this.store.updateTextOverlay(patch);
        this.refreshPreviewAndScheduleEncode(false);
      },
      onChangeEncoding: (patch) => {
        this.store.updateEncoding(patch);
        this.refreshPreviewAndScheduleEncode(false);
      },
      onDownloadJpeg: () => {
        this.handleDownloadJpeg();
      },
      onUploadToDevice: () => {
        void this.handleUploadToDevice();
      },
      onRefreshTelemetry: () => {
        void this.handleRefreshTelemetry();
      },
    });

    this.deviceDetailPanel = new DeviceDetailPanel(
      t,
      this.store.snapshot,
      this.logPanel.element,
      {
        onBack: () => {
          this.navigateBack();
        },
        onConnectAndSend: (deviceId) => {
          void this.handleSelectBadgeAndPush(deviceId);
        },
        onConnectDevice: (deviceId) => {
          void this.handleConnect(true, deviceId);
        },
        onDisconnect: () => {
          void this.handleDisconnect();
        },
        onRefreshTelemetry: () => {
          void this.handleRefreshTelemetry();
        },
        onRenameDevice: (deviceId, nextNickname) => {
          this.handleRenameSavedDevice(deviceId, nextNickname);
        },
        onForgetDevice: (deviceId) => this.handleForgetSavedDevice(deviceId),
        onUpdateReconnectPrefs: (patch) => {
          this.updateReconnectPrefs(patch);
        },
        onToggleAcceptAll: (checked) => {
          this.store.patchState({ acceptAllDevices: checked });
        },
        onToggleWriteWithoutResponse: (checked) => {
          this.store.patchState({ preferWriteWithoutResponse: checked });
        },
        onCopyText: (text, announcement) => {
          void this.copyTextToClipboard(text, announcement);
        },
      }
    );

    const homeViewEl = createEl(
      "div",
      { className: "screen-panel", attrs: { "data-screen": "home" } },
      [this.homePanel.element]
    );
    const pushViewEl = createEl(
      "div",
      { className: "screen-panel", attrs: { "data-screen": "push" } },
      [this.badgeEditor.screenElement]
    );
    const detailViewEl = createEl(
      "div",
      { className: "screen-panel", attrs: { "data-screen": "device-detail" } },
      [this.deviceDetailPanel.element]
    );
    this.screenPanels = {
      home: homeViewEl,
      push: pushViewEl,
      "device-detail": detailViewEl,
    };

    const screenStackEl = createEl("div", { className: "screen-stack" }, [
      homeViewEl,
      pushViewEl,
      detailViewEl,
    ]);
    const mainEl = createEl("main", { className: "app-main" }, [screenStackEl]);

    this.footerPrivacyEl = createEl("p", { text: t.footer.privacyGuarantee });
    const footerCreditEl = createEl("p", {
      text: "BG02 Studio · MIT License · GitHub Pages Ready",
    });
    const footerEl = createEl("footer", { className: "app-footer" }, [
      this.footerPrivacyEl,
      footerCreditEl,
    ]);

    rootContainer.replaceChildren(
      headerEl,
      this.unsupportedBannerEl,
      this.feedbackBannerEl,
      this.politeLiveEl,
      mainEl,
      footerEl
    );

    this.initializeHistoryRouting();

    this.store.subscribe((state) => this.renderAll(state));
    this.i18n.subscribe((_locale, nextDict) => {
      this.applyLocale(nextDict, this.store.snapshot);
    });

    applyScreenVisibility(this.screenPanels, this.store.snapshot.activeScreen, "none");
    this.renderAll(this.store.snapshot);
    this.refreshPreviewAndScheduleEncode(true);
    this.registerServiceWorker();
    this.startTelemetryPoller();
    void this.initializePermittedDevicesAndAutoConnect();
  }

  /**
   * Synchronizes all screens, feedback banners, and PWA readiness pill with latest state.
   *
   * @param state - Latest immutable state snapshot.
   */
  private renderAll(state: AppStateSnapshot): void {
    this.offlinePillEl.hidden = !state.serviceWorkerActive;

    if (state.actionErrorBanner) {
      this.feedbackBannerEl.textContent = state.actionErrorBanner;
      this.feedbackBannerEl.setAttribute("data-tone", "err");
      this.feedbackBannerEl.setAttribute("role", "alert");
      this.feedbackBannerEl.hidden = false;
    } else if (state.uploadSuccessBanner) {
      this.feedbackBannerEl.textContent = state.uploadSuccessBanner;
      this.feedbackBannerEl.setAttribute("data-tone", "ok");
      this.feedbackBannerEl.setAttribute("role", "status");
      this.feedbackBannerEl.hidden = false;
    } else {
      this.feedbackBannerEl.hidden = true;
    }

    this.homePanel.render(state);
    this.badgeEditor.render(state);
    this.deviceDetailPanel.render(state);
    this.logPanel.render(state);
  }

  /**
   * Applies newly selected locale strings across header, footer, and all 3 drill-down screens.
   *
   * @param nextDict - Newly active translation dictionary.
   * @param state - Current state snapshot.
   */
  private applyLocale(nextDict: TranslationSchema, state: AppStateSnapshot): void {
    this.titleEl.textContent = nextDict.header.appTitle;
    this.subtitleEl.textContent = nextDict.header.appSubtitle;
    this.langLabelEl.textContent = nextDict.header.languageLabel;
    this.offlinePillEl.textContent = nextDict.header.offlineReadyBadge;
    this.unsupportedBannerEl.textContent = nextDict.header.unsupportedBleBanner;
    this.footerPrivacyEl.textContent = nextDict.footer.privacyGuarantee;

    this.homePanel.updateLocale(nextDict, state);
    this.badgeEditor.updateLocale(nextDict, state);
    this.deviceDetailPanel.updateLocale(nextDict, state);
    this.logPanel.updateLocale(nextDict, state);
  }

  /**
   * Checks browser-permitted Web Bluetooth handles at startup (`getDevices()`) and,
   * when `autoConnectOnStartup` is enabled, attempts a silent non-intrusive reconnect.
   */
  private async initializePermittedDevicesAndAutoConnect(): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.bluetooth) {
      return;
    }

    const liveIds = await this.client.refreshPermittedDevices();
    this.store.patchState({
      liveDeviceIds: liveIds,
      canReconnect: this.client.canReconnect,
    });

    const snap = this.store.snapshot;
    if (!snap.reconnectPrefs.autoConnectOnStartup || snap.connectionStatus !== "disconnected") {
      return;
    }

    const targetId = pickStartupReconnectTarget(
      snap.savedDevices,
      new Set(liveIds),
      snap.reconnectPrefs
    );
    if (!targetId) {
      return;
    }

    this.store.appendLog("info", `Startup auto-connect targeting badge id=${targetId}...`);
    await this.handleConnect(true, targetId, true);
  }

  /**
   * Cancels any in-flight exponential-backoff auto-reconnect loop cleanly.
   */
  private cancelAutoReconnect(): void {
    this.reconnectRunId += 1;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.store.snapshot.connectionStatus === "reconnecting") {
      this.store.patchState({
        connectionStatus: "disconnected",
        reconnectStatus: null,
      });
    }
  }

  /**
   * Sleeps for `delayMs` while listening to cancellation via `this.reconnectRunId`.
   *
   * @param delayMs - Backoff interval in milliseconds.
   * @param runId - Captured loop generation token.
   * @returns `true` if timer elapsed without cancellation.
   */
  private waitForReconnectBackoff(delayMs: number, runId: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        resolve(this.reconnectRunId === runId);
      }, delayMs);
    });
  }

  /**
   * Retries connecting to a dropped badge up to 3 times using exponential backoff.
   *
   * @param targetDeviceId - Web Bluetooth `device.id` of the dropped BG02 badge.
   */
  private async runAutoReconnectLoop(targetDeviceId: string): Promise<void> {
    this.cancelAutoReconnect();
    const runId = this.reconnectRunId;
    const maxAttempts = AUTO_RECONNECT_DELAYS_MS.length;

    for (let idx = 0; idx < maxAttempts; idx++) {
      const attempt = idx + 1;
      if (runId !== this.reconnectRunId || this.client.isConnected) {
        return;
      }

      this.store.patchState({
        connectionStatus: "reconnecting",
        activeDeviceId: targetDeviceId,
        reconnectStatus: { attempt, maxAttempts, targetDeviceId },
        uploadProgress: null,
      });

      const waitedCleanly = await this.waitForReconnectBackoff(AUTO_RECONNECT_DELAYS_MS[idx], runId);
      if (!waitedCleanly || runId !== this.reconnectRunId || this.client.isConnected) {
        return;
      }

      try {
        const snap = this.store.snapshot;
        const initialMeta = await this.client.connect({
          acceptAllDevices: snap.acceptAllDevices,
          reuseDevice: true,
          deviceId: targetDeviceId,
          preferWriteWithoutResponse: snap.preferWriteWithoutResponse,
        });

        // 意図: 接続待ち中にユーザーが明示キャンセルした場合は、確立直後のリンクを即座に閉じて状態整合性を保つ。
        if (runId !== this.reconnectRunId) {
          await this.client.disconnect();
          return;
        }

        this.recordConnectedProfile(initialMeta);
        this.store.patchState({
          connectionStatus: "connected",
          canReconnect: this.client.canReconnect,
          metadata: initialMeta,
          reconnectStatus: null,
          actionErrorBanner: null,
        });

        await this.queryDeviceTelemetry(initialMeta);
        return;
      } catch (err) {
        const msg = formatErrorForUser(err, this.i18n.t);
        this.store.appendLog("warn", `Auto-reconnect (${attempt}/${maxAttempts}) failed: ${msg}`);
      }
    }

    if (runId === this.reconnectRunId && !this.client.isConnected) {
      this.store.patchState({
        connectionStatus: "error",
        reconnectStatus: null,
        canReconnect: this.client.canReconnect,
        actionErrorBanner: interpolate(this.i18n.t.editor.actionError, {
          reason: this.i18n.t.connection.statusError,
        }),
      });
    }
  }

  /**
   * Connects, switches, or reconnects to a BG02 badge and loads initial device telemetry.
   *
   * @param reuseDevice - True to connect using a cached/permitted handle without chooser when available.
   * @param targetDeviceId - Optional specific saved `device.id` to target.
   * @param silentFailure - When `true` (startup auto-connect), logs unavailable sleep states without error banners.
   */
  private async handleConnect(
    reuseDevice: boolean,
    targetDeviceId?: string,
    silentFailure = false
  ): Promise<boolean> {
    this.cancelAutoReconnect();
    const myRunId = this.reconnectRunId;

    let shouldReuse = reuseDevice;
    if (shouldReuse && targetDeviceId && !this.client.hasLiveDevice(targetDeviceId)) {
      const liveIds = await this.client.refreshPermittedDevices();
      this.store.patchState({ liveDeviceIds: liveIds });

      if (!this.client.hasLiveDevice(targetDeviceId)) {
        // 意図: Chrome 再起動後などで getDevices() が空の場合は親切な案内を出してピッカー選択へフォールバックする。
        const saved = this.store.snapshot.savedDevices.find((d) => d.id === targetDeviceId);
        const notice = interpolate(this.i18n.t.connection.deviceNeedsRepairNotice, {
          name: saved?.nickname || "BG02",
        });
        this.store.appendLog("info", notice);
        this.politeLiveEl.textContent = notice;
        shouldReuse = false;
      }
    }

    const snap = this.store.snapshot;
    this.store.patchState({
      connectionStatus: "connecting",
      activeDeviceId: targetDeviceId ?? snap.activeDeviceId,
      reconnectStatus: null,
      actionErrorBanner: null,
      uploadSuccessBanner: null,
    });

    try {
      const initialMeta = await this.client.connect({
        acceptAllDevices: snap.acceptAllDevices,
        reuseDevice: shouldReuse,
        deviceId: targetDeviceId,
        preferWriteWithoutResponse: snap.preferWriteWithoutResponse,
      });

      if (myRunId !== this.reconnectRunId) {
        return false;
      }

      this.recordConnectedProfile(initialMeta);
      this.store.patchState({
        connectionStatus: "connected",
        canReconnect: this.client.canReconnect,
        metadata: initialMeta,
        reconnectStatus: null,
      });

      await this.queryDeviceTelemetry(initialMeta);
      return myRunId === this.reconnectRunId && this.client.isConnected;
    } catch (err) {
      const msg = formatErrorForUser(err, this.i18n.t);
      if (silentFailure) {
        this.store.appendLog("info", `Startup auto-connect skipped: ${msg}`);
        this.store.patchState({
          connectionStatus: this.client.isConnected ? "connected" : "disconnected",
          canReconnect: this.client.canReconnect,
        });
        return false;
      }
      this.store.appendLog("error", `Connection error: ${msg}`);
      this.store.patchState({
        connectionStatus: this.client.isConnected ? "connected" : "error",
        canReconnect: this.client.canReconnect,
        actionErrorBanner: interpolate(this.i18n.t.editor.actionError, { reason: msg }),
      });
      return false;
    }
  }

  /**
   * Syncs initial history entry and handles browser/OS Back gestures cleanly via `popstate`.
   */
  private initializeHistoryRouting(): void {
    if (typeof window === "undefined" || !window.history) {
      return;
    }
    try {
      window.history.replaceState(
        {
          screen: this.store.snapshot.activeScreen,
          detailDeviceId: this.store.snapshot.detailDeviceId,
        },
        ""
      );
    } catch {
      // Ignore sandboxed history restrictions cleanly
    }

    window.addEventListener("popstate", (ev: PopStateEvent) => {
      const route = resolvePopStateRoute(ev.state);
      this.hasPushedSubscreenHistory = route.screen !== "home";
      this.navigateToScreen(route.screen, {
        detailDeviceId: route.detailDeviceId,
        viaPopState: true,
      });
    });
  }

  /**
   * Transitions between drill-down views, updates `inert` isolation, manages browser history,
   * and moves keyboard focus without jumping page scroll (`focus({ preventScroll: true })`).
   *
   * @param targetScreen - Destination screen (`"home" | "push" | "device-detail"`).
   * @param options - Optional target device detail ID, popstate marker, and trigger element.
   */
  private navigateToScreen(
    targetScreen: AppScreenId,
    options?: {
      detailDeviceId?: string | null;
      viaPopState?: boolean;
      triggerEl?: HTMLElement | null;
    }
  ): void {
    const prevScreen = this.store.snapshot.activeScreen;
    if (prevScreen === "home" && targetScreen !== "home") {
      const activeEl =
        options?.triggerEl ??
        (typeof document !== "undefined" && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null);
      this.lastHomeTriggerEl = activeEl;
    }

    const direction: "forward" | "back" | "none" =
      prevScreen === "home" && targetScreen !== "home"
        ? "forward"
        : prevScreen !== "home" && targetScreen === "home"
          ? "back"
          : "none";

    if (
      !options?.viaPopState &&
      shouldPushHistoryEntry(prevScreen, targetScreen, Boolean(options?.viaPopState)) &&
      typeof window !== "undefined" &&
      window.history
    ) {
      try {
        window.history.pushState(
          {
            screen: targetScreen,
            detailDeviceId: options?.detailDeviceId ?? this.store.snapshot.detailDeviceId,
          },
          ""
        );
        this.hasPushedSubscreenHistory = true;
      } catch {
        this.hasPushedSubscreenHistory = false;
      }
    }

    this.store.patchState({
      activeScreen: targetScreen,
      ...(options?.detailDeviceId !== undefined
        ? { detailDeviceId: options.detailDeviceId }
        : {}),
    });

    applyScreenVisibility(this.screenPanels, targetScreen, direction);

    queueMicrotask(() => {
      if (targetScreen === "push") {
        focusAfterNavigation(this.badgeEditor.backBtn);
      } else if (targetScreen === "device-detail") {
        focusAfterNavigation(this.deviceDetailPanel.backBtn);
      } else {
        focusAfterNavigation(this.lastHomeTriggerEl);
      }
    });
  }

  /**
   * Handles explicit `<` Back button presses cleanly, syncing browser history if present.
   */
  private navigateBack(): void {
    if (
      this.hasPushedSubscreenHistory &&
      typeof window !== "undefined" &&
      window.history &&
      typeof window.history.back === "function"
    ) {
      this.hasPushedSubscreenHistory = false;
      window.history.back();
      return;
    }
    this.navigateToScreen("home");
  }

  /**
   * Connects to the selected saved badge if not already linked (Answer A1) and transitions
   * to Screen 2 (`"push"`) upon success.
   *
   * @param deviceId - Identifier of the selected BG02 badge card.
   */
  private async handleSelectBadgeAndPush(deviceId: string): Promise<void> {
    const triggerEl =
      typeof document !== "undefined" && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    if (this.client.isConnected && this.client.activeId === deviceId) {
      this.navigateToScreen("push", { triggerEl });
      return;
    }

    const connected = await this.handleConnect(true, deviceId);
    if (connected) {
      this.navigateToScreen("push", { triggerEl });
    }
  }

  /**
   * Starts a gentle 30-second periodic poll updating connected battery & free storage while idle.
   */
  private startTelemetryPoller(): void {
    if (this.telemetryPollTimer !== null) {
      clearInterval(this.telemetryPollTimer);
    }
    this.telemetryPollTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      if (
        !this.client.isConnected ||
        this.isUploadWorkflowActive ||
        this.isTelemetryQueryInFlight ||
        this.store.snapshot.connectionStatus !== "connected"
      ) {
        return;
      }
      const existing = this.store.snapshot.metadata;
      if (existing) {
        void this.queryDeviceTelemetry(existing, true);
      }
    }, TELEMETRY_POLL_INTERVAL_MS);
  }

  /**
   * Saves/updates a connected badge profile and remembers it as the last active badge.
   *
   * @param meta - Initial connection metadata containing `deviceId` and advertised name.
   * @param enriched - Optional telemetry fields queried after handshake.
   */
  private recordConnectedProfile(
    meta: ConnectedDeviceMetadata,
    enriched?: {
      batteryPercent?: number;
      firmwareRevision?: string;
      displaySpec?: string;
      freeStorageBytes?: number | null;
    }
  ): void {
    const snap = this.store.snapshot;
    const nextProfiles = upsertDeviceProfile(snap.savedDevices, {
      id: meta.deviceId,
      advertisedName: meta.deviceName,
      batteryPercent: enriched?.batteryPercent,
      firmwareRevision: enriched?.firmwareRevision,
      displaySpec: enriched?.displaySpec,
      freeStorageBytes: enriched?.freeStorageBytes,
      connectedAtMs: Date.now(),
    });
    saveDeviceProfiles(nextProfiles);

    const nextPrefs = {
      ...snap.reconnectPrefs,
      lastActiveDeviceId: meta.deviceId,
    };
    saveReconnectPrefs(nextPrefs);

    this.store.patchState({
      savedDevices: nextProfiles,
      liveDeviceIds: this.client.getLiveDeviceIds(),
      activeDeviceId: meta.deviceId,
      reconnectPrefs: nextPrefs,
    });
  }

  /**
   * Updates user-configured auto-reconnect toggles and persists them to `localStorage`.
   *
   * @param patch - Updated preference fields.
   */
  private updateReconnectPrefs(
    patch: Partial<{ autoRetryOnDrop: boolean; autoConnectOnStartup: boolean }>
  ): void {
    const next = {
      ...this.store.snapshot.reconnectPrefs,
      ...patch,
    };
    saveReconnectPrefs(next);
    this.store.patchState({ reconnectPrefs: next });
  }

  /**
   * Updates a saved badge's custom nickname cleanly and persists the list.
   *
   * @param deviceId - Saved badge identifier.
   * @param nextNickname - Trimmed custom display label.
   */
  private handleRenameSavedDevice(deviceId: string, nextNickname: string): void {
    const nextProfiles = renameDeviceProfile(
      this.store.snapshot.savedDevices,
      deviceId,
      nextNickname
    );
    saveDeviceProfiles(nextProfiles);
    this.store.patchState({ savedDevices: nextProfiles });
  }

  /**
   * Disconnects if active, removes a saved badge profile from local storage, and invokes `device.forget()`.
   *
   * @param deviceId - Saved badge identifier to forget.
   * @returns `true` if `device.forget()` natively revoked browser permission.
   */
  private async handleForgetSavedDevice(deviceId: string): Promise<boolean> {
    if (this.client.activeId === deviceId && this.client.isConnected) {
      await this.handleDisconnect();
    }
    const browserRevoked = await this.client.forgetCachedDevice(deviceId);

    const snap = this.store.snapshot;
    const nextProfiles = removeDeviceProfile(snap.savedDevices, deviceId);
    saveDeviceProfiles(nextProfiles);

    const nextActiveId =
      snap.activeDeviceId === deviceId ? (nextProfiles[0]?.id ?? null) : snap.activeDeviceId;
    const nextDetailId =
      snap.detailDeviceId === deviceId ? nextActiveId : snap.detailDeviceId;
    const nextPrefs =
      snap.reconnectPrefs.lastActiveDeviceId === deviceId
        ? { ...snap.reconnectPrefs, lastActiveDeviceId: nextActiveId }
        : snap.reconnectPrefs;
    saveReconnectPrefs(nextPrefs);

    this.store.patchState({
      savedDevices: nextProfiles,
      liveDeviceIds: this.client.getLiveDeviceIds(),
      activeDeviceId: nextActiveId,
      detailDeviceId: nextDetailId,
      reconnectPrefs: nextPrefs,
      canReconnect: this.client.canReconnect,
    });
    return browserRevoked;
  }

  /**
   * Disconnects from the active GATT server while retaining the device reference for reconnect.
   */
  private async handleDisconnect(): Promise<void> {
    this.cancelAutoReconnect();
    await this.client.disconnect();
    this.store.patchState({
      connectionStatus: "disconnected",
      canReconnect: this.client.canReconnect,
      uploadProgress: null,
      reconnectStatus: null,
    });
  }

  /**
   * Queries updated Dial Info (`0x20/0x02`), Free Storage (`0x20/0x04`), Battery, and DIS.
   */
  private async handleRefreshTelemetry(): Promise<void> {
    const existing = this.store.snapshot.metadata;
    if (!existing) {
      return;
    }
    await this.queryDeviceTelemetry(existing, false);
  }

  /**
   * Executes telemetry queries after connection, manual refresh, or 30s background polling.
   *
   * @param baseMetadata - Current session metadata to enrich cleanly.
   * @param isBackgroundPoll - When `true`, skips re-encoding canvas output unless geometry changed.
   */
  private async queryDeviceTelemetry(
    baseMetadata: ConnectedDeviceMetadata,
    isBackgroundPoll = false
  ): Promise<void> {
    if (this.isTelemetryQueryInFlight) {
      return;
    }
    this.isTelemetryQueryInFlight = true;
    try {
      const prevGeom = resolveTargetGeometry(baseMetadata.dialInfo);
      let dialInfo: ClockDialInfo | null = baseMetadata.dialInfo;
      let freeStorageBytes: number | null = baseMetadata.freeStorageBytes;
      let freeStorageError: string | null = null;
      let standardInfo: StandardDeviceInfo | null = baseMetadata.standardInfo;

      if (!isBackgroundPoll || !dialInfo) {
        try {
          dialInfo = await this.client.getDialInfo();
        } catch (err) {
          const msg = formatErrorForUser(err, this.i18n.t);
          this.store.appendLog("warn", `Dial info query skipped/failed: ${msg}`);
        }
      }

      try {
        freeStorageBytes = await this.client.getFreeStorage();
      } catch (err) {
        const msg = formatErrorForUser(err, this.i18n.t);
        freeStorageError = msg;
        this.store.appendLog("warn", `Free storage query warning: ${msg}`);
      }

      try {
        standardInfo = await this.client.readStandardInfo();
      } catch (err) {
        const msg = formatErrorForUser(err, this.i18n.t);
        this.store.appendLog("warn", `Standard DIS/Battery warning: ${msg}`);
      }

      this.store.patchState({
        metadata: {
          ...baseMetadata,
          dialInfo,
          freeStorageBytes,
          freeStorageError,
          standardInfo,
        },
      });

      const displaySpec = dialInfo
        ? `${dialInfo.width}×${dialInfo.height} (${dialInfo.shape}), ${dialInfo.algorithmName}`
        : undefined;
      this.recordConnectedProfile(baseMetadata, {
        batteryPercent: standardInfo?.batteryPercent,
        firmwareRevision: standardInfo?.firmwareRevision,
        displaySpec,
        freeStorageBytes,
      });

      const nextGeom = resolveTargetGeometry(dialInfo);
      const geometryChanged =
        nextGeom.width !== prevGeom.width ||
        nextGeom.height !== prevGeom.height ||
        nextGeom.shape !== prevGeom.shape;
      if (!isBackgroundPoll || geometryChanged) {
        this.refreshPreviewAndScheduleEncode(true);
      }
    } finally {
      this.isTelemetryQueryInFlight = false;
    }
  }

  /**
   * Loads a locally picked or dropped image file into memory and centers it in Cover fit.
   *
   * @param file - User-selected local image file.
   */
  private async handleSelectImageFile(file: File): Promise<void> {
    try {
      const img = await loadLocalImageFile(file);
      this.loadedImage = img;
      this.store.patchState({
        sourceMeta: {
          fileName: file.name,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        },
        transform: {
          ...this.store.snapshot.transform,
          offsetX: 0,
          offsetY: 0,
          scale: 1.0,
          rotationDeg: 0,
        },
        actionErrorBanner: null,
        uploadSuccessBanner: null,
      });
      this.refreshPreviewAndScheduleEncode(true);
    } catch (err) {
      const msg = formatErrorForUser(err, this.i18n.t);
      this.store.patchState({
        actionErrorBanner: interpolate(this.i18n.t.editor.actionError, { reason: msg }),
      });
    }
  }

  /**
   * Synchronously updates preview canvas framing pixels and schedules a debounced JPEG encode.
   *
   * @param immediate - When `true`, skips the 100ms debounce delay.
   */
  private refreshPreviewAndScheduleEncode(immediate: boolean): void {
    const snap = this.store.snapshot;
    const geometry = resolveTargetGeometry(snap.metadata?.dialInfo);

    renderExportComposition(
      this.offscreenExportCanvas,
      this.loadedImage,
      snap.transform,
      snap.textOverlay,
      geometry
    );
    renderPreviewWithGuides(this.badgeEditor.previewCanvas, this.offscreenExportCanvas, geometry.shape);

    if (this.encodeTimer !== null) {
      clearTimeout(this.encodeTimer);
      this.encodeTimer = null;
    }

    const runEncode = async (): Promise<void> => {
      const token = ++this.encodeSequence;
      try {
        const latestSnap = this.store.snapshot;
        const latestGeometry = resolveTargetGeometry(latestSnap.metadata?.dialInfo);
        const result = await composeAndEncodeBadge(
          this.loadedImage,
          latestSnap.transform,
          latestSnap.textOverlay,
          latestSnap.encoding,
          latestGeometry,
          this.offscreenExportCanvas
        );
        if (token === this.encodeSequence) {
          this.store.patchState({ latestOutput: result });
        }
      } catch (err) {
        if (token === this.encodeSequence) {
          const msg = formatErrorForUser(err, this.i18n.t);
          this.store.appendLog("error", `JPEG compose error: ${msg}`);
        }
      }
    };

    if (immediate) {
      void runEncode();
    } else {
      this.encodeTimer = setTimeout(() => {
        this.encodeTimer = null;
        void runEncode();
      }, ENCODE_DEBOUNCE_MS);
    }
  }

  /**
   * Forces an immediate fresh Baseline JPEG compose pass so BLE upload always uses current edits.
   *
   * @returns Fresh {@link CompositedBadgeResult}.
   */
  private async composeFreshOutput(): Promise<CompositedBadgeResult> {
    if (this.encodeTimer !== null) {
      clearTimeout(this.encodeTimer);
      this.encodeTimer = null;
    }
    const token = ++this.encodeSequence;
    const snap = this.store.snapshot;
    const geometry = resolveTargetGeometry(snap.metadata?.dialInfo);
    const result = await composeAndEncodeBadge(
      this.loadedImage,
      snap.transform,
      snap.textOverlay,
      snap.encoding,
      geometry,
      this.offscreenExportCanvas
    );
    if (token === this.encodeSequence) {
      this.store.patchState({ latestOutput: result });
    }
    return result;
  }

  /**
   * Saves the currently composed `240x240` Baseline JPEG locally via an ephemeral Object URL.
   */
  private handleDownloadJpeg(): void {
    const out = this.store.snapshot.latestOutput;
    if (!out) {
      return;
    }
    const copy = new Uint8Array(out.jpegBytes);
    const blob = new Blob([copy], { type: "image/jpeg" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = DEFAULT_EXPORT_FILENAME;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Verifies that an active BG02 GATT session is established before composing or sending an image,
   * automatically reconnecting (or opening the device picker when permitted) if disconnected.
   *
   * // 意図: 画像送信押下時に未接続またはリンク切れ状態であっても、再接続と解像度再取得を自動完了させてから送信する。
   *
   * @param allowChooser - Whether opening `requestDevice()` is permitted within the active click gesture.
   * @returns `true` once a live GATT link and handshake are ready for upload.
   */
  private async ensureConnectedForUpload(allowChooser: boolean): Promise<boolean> {
    if (this.client.isConnected) {
      return true;
    }

    const snap = this.store.snapshot;
    const plan = resolveUploadReconnectPlan({
      activeDeviceId: snap.activeDeviceId,
      clientActiveId: this.client.activeId,
      canReconnect: this.client.canReconnect,
      savedDevices: snap.savedDevices,
      liveDeviceIds: snap.liveDeviceIds,
      prefs: snap.reconnectPrefs,
    });

    if (!allowChooser) {
      const liveId =
        plan.targetDeviceId && this.client.hasLiveDevice(plan.targetDeviceId)
          ? plan.targetDeviceId
          : undefined;
      if (!liveId && !this.client.canReconnect) {
        return false;
      }
      return this.handleConnect(true, liveId);
    }

    this.store.appendLog(
      "info",
      "Upload requested while disconnected; verifying/reconnecting BG02 before transfer..."
    );
    return this.handleConnect(plan.reuseDevice, plan.targetDeviceId);
  }

  /**
   * Encodes a fresh Baseline JPEG matched to the connected badge's latest dial geometry
   * and validates SOF0 compliance prior to BLE upload.
   *
   * @returns Verified Baseline JPEG bytes ready for `WatchTheme3`.
   */
  private async composeValidatedUploadBytes(): Promise<Uint8Array> {
    const output = await this.composeFreshOutput();
    const dial = this.store.snapshot.metadata?.dialInfo;
    if (!isUploadableJpeg(output.inspection, dial?.width, dial?.height)) {
      throw new Error(this.i18n.t.editor.errorInvalidJpeg);
    }
    return output.jpegBytes;
  }

  /**
   * Waits for a bounded settle delay before executing an automatic resend attempt.
   *
   * @param ms - Pause duration in milliseconds.
   */
  private sleepMs(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Restores or recycles the BG02 GATT connection before an automatic full re-upload attempt.
   *
   * @param retryAttempt - 1-based retry attempt index (`1..UPLOAD_MAX_AUTO_RETRIES`).
   */
  private async prepareConnectionForUploadRetry(retryAttempt: number): Promise<void> {
    await this.sleepMs(UPLOAD_RETRY_SETTLE_DELAY_MS);
    // 意図: 完了待ち等で同じ GATT セッション上の再送が連続してタイムアウトする場合、
    //       許可済みキャッシュがある最後の再試行では一度切断して端末側の受信状態と通知パイプラインを初期化する。
    if (
      retryAttempt >= UPLOAD_MAX_AUTO_RETRIES &&
      this.client.isConnected &&
      this.client.canReconnect
    ) {
      this.store.appendLog("info", "Resetting BG02 GATT session before final resend attempt...");
      await this.client.disconnect();
      await this.sleepMs(UPLOAD_RETRY_SETTLE_DELAY_MS);
    }

    if (!this.client.isConnected) {
      const reconnected = await this.ensureConnectedForUpload(false);
      if (!reconnected || !this.client.isConnected) {
        throw new Error("BG02 is not connected");
      }
    }

    this.store.patchState({
      connectionStatus: "uploading",
      actionErrorBanner: null,
      uploadProgress: null,
    });
  }

  /**
   * Runs `WatchTheme3` image transfer with automatic re-transmission when a stall
   * (such as 95% finish timeout) or transient drop occurs.
   *
   * @param trackProgress - UI progress callback invoked during chunk transmission.
   * @returns Final verified {@link UploadDialResult}.
   */
  private async executeUploadWithAutoRetry(
    trackProgress: (progress: UploadProgress) => void
  ): Promise<UploadDialResult> {
    for (let attempt = 0; attempt <= UPLOAD_MAX_AUTO_RETRIES; attempt++) {
      if (attempt > 0) {
        const retryText = interpolate(this.i18n.t.editor.uploadRetrying, {
          attempt: attempt + 1,
          max: UPLOAD_MAX_AUTO_RETRIES + 1,
        });
        this.store.appendLog("warn", retryText);
        this.politeLiveEl.textContent = retryText;
        this.store.patchState({
          connectionStatus: "uploading",
          actionErrorBanner: null,
          uploadProgress: null,
        });
        await this.prepareConnectionForUploadRetry(attempt);
      } else if (!this.client.isConnected) {
        if (!(await this.ensureConnectedForUpload(false)) || !this.client.isConnected) {
          throw new Error("BG02 is not connected");
        }
        this.store.patchState({
          connectionStatus: "uploading",
          actionErrorBanner: null,
          uploadProgress: null,
        });
      }

      const jpegBytes = await this.composeValidatedUploadBytes();
      try {
        return await this.client.uploadDialImage(jpegBytes, {
          onProgress: trackProgress,
        });
      } catch (err) {
        if (!isRetryableUploadError(err) || attempt >= UPLOAD_MAX_AUTO_RETRIES) {
          throw err;
        }
      }
    }

    throw new Error("Upload retry attempts exhausted");
  }

  /**
   * Ensures BG02 connection/reconnection, compiles a fresh Baseline JPEG, validates SOF0/dimensions,
   * and executes `WatchTheme3` BLE transfer with stall/drop auto-resend.
   */
  private async handleUploadToDevice(): Promise<void> {
    const currentStatus = this.store.snapshot.connectionStatus;
    if (currentStatus === "uploading" || currentStatus === "connecting") {
      return;
    }

    this.cancelAutoReconnect();
    if (!(await this.ensureConnectedForUpload(true)) || !this.client.isConnected) {
      return;
    }

    const batteryPercent = this.store.snapshot.metadata?.standardInfo?.batteryPercent;
    if (batteryPercent !== undefined && batteryPercent < 20) {
      this.store.appendLog(
        "warn",
        `Battery is ${batteryPercent}% (<20%); firmware requires >= 20% and unplugged from charger to accept transfers.`
      );
    }

    this.isUploadWorkflowActive = true;
    this.store.patchState({
      connectionStatus: "uploading",
      actionErrorBanner: null,
      uploadSuccessBanner: null,
      uploadProgress: null,
    });

    const trackProgress = (progress: UploadProgress): void => {
      this.store.patchState({ uploadProgress: progress });
    };

    try {
      const result = await this.executeUploadWithAutoRetry(trackProgress);
      const seconds = (result.elapsedMs / 1000).toFixed(1);
      const checksumHex = result.totalChecksum.toString(16).padStart(8, "0");
      const successText = interpolate(this.i18n.t.editor.uploadSuccess, {
        bytes: result.imageBytes.toLocaleString(),
        seconds,
        checksum: checksumHex,
      });

      this.store.appendLog("info", successText);
      this.store.patchState({
        connectionStatus: this.client.isConnected ? "connected" : "disconnected",
        uploadProgress: null,
        uploadSuccessBanner: successText,
      });
      this.politeLiveEl.textContent = successText;
    } catch (err) {
      const msg = formatErrorForUser(err, this.i18n.t);
      this.store.appendLog("error", `Upload failed: ${msg}`);
      this.store.patchState({
        connectionStatus: this.client.isConnected ? "connected" : "error",
        uploadProgress: null,
        actionErrorBanner: interpolate(this.i18n.t.editor.actionError, { reason: msg }),
      });
    } finally {
      this.isUploadWorkflowActive = false;
    }
  }

  /**
   * Copies plain text to the system clipboard and announces completion to screen readers.
   *
   * @param text - Text payload to copy.
   * @param announcement - Accessible live announcement shown on success.
   */
  private async copyTextToClipboard(text: string, announcement: string): Promise<void> {
    if (!text || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      this.politeLiveEl.textContent = announcement;
    } catch (err) {
      const msg = formatErrorForUser(err, this.i18n.t);
      this.store.appendLog("warn", `Clipboard write failed: ${msg}`);
    }
  }

  /**
   * Copies all current log lines to the system clipboard cleanly.
   */
  private async handleCopyLogs(): Promise<void> {
    const lines = this.store.snapshot.logs
      .map((entry) => `[${entry.timestamp}] ${entry.message}`)
      .join("\n");
    await this.copyTextToClipboard(lines, this.i18n.t.logs.copiedToast);
  }

  /**
   * Registers the production static asset Service Worker (`./sw.js`) for offline PWA launches.
   */
  private registerServiceWorker(): void {
    if (
      !import.meta.env.PROD ||
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    // 意図: GitHub Pages サブディレクトリでも解決できるよう相対パス `./sw.js` かつ `scope: "./"` で登録する。
    navigator.serviceWorker
      .register("./sw.js", { scope: "./" })
      .then(() => {
        this.store.patchState({ serviceWorkerActive: true });
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.store.appendLog("warn", `Service Worker registration skipped: ${msg}`);
      });
  }
}

/**
 * Mounts {@link Bg02StudioApp} into `#app` when executing inside a browser document.
 */
if (typeof document !== "undefined") {
  const mount = (): void => {
    const root = requireElement<HTMLElement>(document, "#app");
    new Bg02StudioApp(root);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
}
