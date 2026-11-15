/**
 * @module i18n/types
 * Strictly typed translation schema preventing missing keys or interpolation typos
 * across supported application locales.
 */

import type { DialErrorKey } from "../constants/ble";

/** Supported UI languages exposed by BG02 Studio. */
export type LocaleCode = "ja" | "en";

/** Header and browser capability notice strings. */
export interface HeaderTranslations {
  /** Main application title shown in `<h1>`. */
  readonly appTitle: string;
  /** Concise subtitle highlighting privacy-first local Web Bluetooth execution. */
  readonly appSubtitle: string;
  /** Accessible label for the UI language selector control. */
  readonly languageLabel: string;
  /** Accessible banner warning shown when `navigator.bluetooth` is unavailable. */
  readonly unsupportedBleBanner: string;
  /** PWA offline-cache status badge label when Service Worker is active. */
  readonly offlineReadyBadge: string;
  /** Accessible & visible label for sub-screen `<` Back navigation buttons. */
  readonly btnBack: string;
}

/** Beginner-friendly Home / Device List screen strings (`activeScreen === "home"`). */
export interface HomeTranslations {
  /** Accessible landmark / heading text for the Home device list screen. */
  readonly screenHeading: string;
  /** Onboarding title displayed before any BG02 badge is registered. */
  readonly welcomeTitle: string;
  /** Short friendly onboarding tagline below {@link welcomeTitle}. */
  readonly welcomeLead: string;
  /** Step 1 instruction for first-time BG02 connection. */
  readonly welcomeStep1: string;
  /** Step 2 instruction for first-time BG02 connection. */
  readonly welcomeStep2: string;
  /** Step 3 instruction for selecting a badge and uploading. */
  readonly welcomeStep3: string;
  /** Primary button opening the Bluetooth picker to pair/connect a badge. */
  readonly btnConnectNew: string;
  /** Secondary helper button allowing offline image framing before pairing. */
  readonly btnOpenOfflineEditor: string;
  /** Concise helper subtitle below {@link btnOpenOfflineEditor}. */
  readonly btnOpenOfflineEditorDesc: string;
  /** Home list entry opening Device Details & Bluetooth Unpair instructions. */
  readonly btnOpenUnpairGuide: string;
  /** Concise helper subtitle below {@link btnOpenUnpairGuide}. */
  readonly btnOpenUnpairGuideDesc: string;
  /** Badge card CTA label when the unit is disconnected (connect then push). */
  readonly cardActionConnectAndSend: string;
  /** Badge card CTA label when the unit is already linked (open push immediately). */
  readonly cardActionSend: string;
  /** Secondary action pill opening Device Info & Unpair guide for that badge. */
  readonly cardActionDetail: string;
  /** Compact battery warning hint displayed directly on badge cards when `< 20%`. */
  readonly batteryNoteLow: string;
  /** Concise footer reminder stating >= 20% and charger-unplugged requirement. */
  readonly batteryRuleFooter: string;
  /** Section heading above the list of registered badge cards. */
  readonly sectionDevices: string;
  /** Section heading above Home helper tools & unpair guide rows. */
  readonly sectionMoreActions: string;
}

/** Device Detail, Hardware Specifications & Bluetooth Unpair Guide screen strings. */
export interface DeviceDetailTranslations {
  /** Centered top-bar title for the Device Details screen. */
  readonly screenTitle: string;
  /** Card heading summarizing current link state, nickname edit, and auto-reconnect. */
  readonly sectionStatus: string;
  /** Card heading summarizing firmware, screen size, and free flash storage. */
  readonly sectionSpecs: string;
  /** Card heading explaining browser & OS Bluetooth unpairing steps. */
  readonly sectionUnpair: string;
  /** Collapsible `<summary>` label gating advanced BLE toggles and raw communication logs. */
  readonly sectionDeveloper: string;
  /** Title shown when the Detail view is opened before any device has been paired. */
  readonly noDeviceSelectedTitle: string;
  /** Helpful guidance shown alongside {@link noDeviceSelectedTitle}. */
  readonly noDeviceSelectedHint: string;
  /** Button jumping straight into the Image Select & Push screen for the inspected device. */
  readonly btnSendWithThisDevice: string;
  /** Small tag indicating displayed telemetry came from saved cache while disconnected. */
  readonly cachedInfoBadge: string;
  /** Label for the last connection timestamp readout. */
  readonly lastSyncedLabel: string;
  /** Value shown when a badge has not connected cleanly yet. */
  readonly lastSyncedNever: string;
  /** Plain-language explanation of Web Bluetooth vs. OS Bluetooth pairing boundaries. */
  readonly unpairIntro: string;
  /** Step 1 heading (in-app list removal & `device.forget()`). */
  readonly unpairStep1Title: string;
  /** Step 1 explanation paragraph. */
  readonly unpairStep1Body: string;
  /** Action button forgetting the inspected badge cleanly. */
  readonly btnForgetThisBadge: string;
  /** Feedback notice shown after forgetting a badge when `device.forget()` succeeded (`{name}`). */
  readonly forgetResultBrowserRevoked: string;
  /** Feedback notice shown after local removal when the browser lacks `device.forget()` (`{name}`). */
  readonly forgetResultLocalOnly: string;
  /** Step 2 heading (browser site permission reset). */
  readonly unpairStep2Title: string;
  /** Step 2 explanation paragraph. */
  readonly unpairStep2Body: string;
  /** Chrome/Edge Bluetooth site-permissions internal settings path (`chrome://...`). */
  readonly unpairChromeUrl: string;
  /** Button copying {@link unpairChromeUrl} cleanly to clipboard. */
  readonly btnCopyChromeUrl: string;
  /** Confirmation toast after copying the Chrome Bluetooth settings URL. */
  readonly copiedChromeUrlToast: string;
  /** Step 3 heading (OS Bluetooth Settings removal). */
  readonly unpairStep3Title: string;
  /** Windows unpairing instructions line. */
  readonly unpairStep3Windows: string;
  /** Android unpairing instructions line. */
  readonly unpairStep3Android: string;
  /** macOS / iOS / Bluefy unpairing instructions line. */
  readonly unpairStep3Apple: string;
}

/** BLE connection, telemetry readout, and link-mode checkbox strings. */
export interface ConnectionTranslations {
  /** Section heading (`<h2>`) for Panel 1. */
  readonly heading: string;
  /** Button opening Web Bluetooth device chooser. */
  readonly btnConnect: string;
  /** Secondary button switching to a different BLE device when a cached one exists. */
  readonly btnChangeDevice: string;
  /** Button reconnecting directly to the previously selected BG02 device. */
  readonly btnReconnect: string;
  /** Button gracefully disconnecting the GATT link. */
  readonly btnDisconnect: string;
  /** Button re-querying Dial Info (`0x20/0x02`), Free Storage (`0x20/0x04`), Battery, and DIS. */
  readonly btnRefreshTelemetry: string;
  /** Checkbox toggling `acceptAllDevices: true` scan filter mode. */
  readonly optAcceptAllDevices: string;
  /** Checkbox toggling `writeValueWithoutResponse` priority pacing mode. */
  readonly optPreferWriteWithoutResponse: string;
  /** Status badge label when disconnected. */
  readonly statusDisconnected: string;
  /** Status badge label while connecting and shaking hands. */
  readonly statusConnecting: string;
  /** Status badge label template while running automatic disconnect retries (`{attempt}`, `{max}`). */
  readonly statusReconnecting: string;
  /** Status badge label when GATT + `Lqm2.r` pairing succeeded. */
  readonly statusConnected: string;
  /** Status badge label during active WatchTheme3 upload. */
  readonly statusUploading: string;
  /** Status badge label when the last connection/upload ended in an error. */
  readonly statusError: string;
  /** Multi-device switcher heading above saved badge chips. */
  readonly deviceShelfHeading: string;
  /** Hint shown in the multi-device shelf before any badge has been saved. */
  readonly deviceEmptyHint: string;
  /** Button pairing and registering an additional BG02 badge. */
  readonly btnAddDevice: string;
  /** Button canceling an active automatic reconnect sequence. */
  readonly btnCancelReconnect: string;
  /** Checkbox enabling exponential-backoff auto-retry after unexpected drops. */
  readonly optAutoRetryOnDrop: string;
  /** Checkbox enabling startup auto-connect to the last permitted badge. */
  readonly optAutoConnectOnStartup: string;
  /** Chip tag indicating a saved badge has a live cached handle (`Ready`). */
  readonly deviceReadyBadge: string;
  /** Chip tag indicating a saved badge needs re-selection via chooser if unavailable via `getDevices()`. */
  readonly devicePairRequiredBadge: string;
  /** Accessible button label opening the inline badge nickname editor. */
  readonly btnRenameDevice: string;
  /** Confirm button saving an edited badge nickname. */
  readonly btnSaveNickname: string;
  /** Cancel button closing the inline badge nickname editor. */
  readonly btnCancelRename: string;
  /** Accessible button label removing a badge profile from local storage. */
  readonly btnForgetDevice: string;
  /** Placeholder text inside the inline badge nickname field. */
  readonly renamePlaceholder: string;
  /** Banner text shown during auto-reconnect with `{name}`, `{attempt}`, `{max}`. */
  readonly reconnectingNotice: string;
  /** Log/notice shown when a saved badge lacks a live handle and falls back to browser picker. */
  readonly deviceNeedsRepairNotice: string;
  /** Default placeholder subtitle in the hero card before connecting a badge. */
  readonly heroDisconnectedSubtitle: string;
  /** Accordion title for the saved badges manager and auto-reconnect settings. */
  readonly funcBadgesTitle: string;
  /** Accordion title for detailed hardware telemetry, BLE options, and debug logs. */
  readonly funcLogsTitle: string;
  /** Telemetry row label for Battery percentage. */
  readonly labelBattery: string;
  /** Short low-battery warning tag displayed in the connection bar when <= 25%. */
  readonly batteryLowWarning: string;
  /** Telemetry row label for firmware/hardware revisions. */
  readonly labelFirmwareHardware: string;
  /** Telemetry row label for display dimensions, shape, and encoding. */
  readonly labelDisplaySpec: string;
  /** Telemetry row label for available flash storage bytes. */
  readonly labelFreeStorage: string;
  /** Telemetry row label for manufacturer / MCU / customer strings. */
  readonly labelModelInfo: string;
  /** Fallback text before device telemetry has been read. */
  readonly valueNotRead: string;
  /** Notice displayed when `0x20/0x04` timed out on firmware that delays reporting. */
  readonly freeStorageTimedOut: string;
  /** Summary label for the bottom collapsible developer & diagnostics drawer. */
  readonly advancedDrawerSummary: string;
  /** Short section label above Function accordion rows. */
  readonly sectionFunctionHeading: string;
}

/** Circular image editor, transform controls, optional text overlay, and upload strings. */
export interface EditorTranslations {
  /** Section heading (`<h2>`) for Panel 2. */
  readonly heading: string;
  /** Instructional prompt inside or above the file drop area. */
  readonly dropzonePrompt: string;
  /** Accessible file picker button text. */
  readonly btnSelectFile: string;
  /** Camera capture tile button text (mobile camera or image picker). */
  readonly btnTakePhoto: string;
  /** Short section label above Select Image pastel tiles. */
  readonly sectionSelectImage: string;
  /** Compact crop size label directly below preview circle (`{kb}`). */
  readonly cropSizeSummary: string;
  /** Compact device remaining storage line below Upload pill (`{space}`). */
  readonly remainingSpaceSummary: string;
  /** Short Refresh pill button beside remaining storage readout. */
  readonly btnRefreshShort: string;
  /** Accordion title for fine position, rotation, and text settings. */
  readonly funcFineEditTitle: string;
  /** Accordion title for JPEG optimization, SOF0 check, and local export. */
  readonly funcExportTitle: string;
  /** Inviting tap target shown over an empty circular canvas before picking a photo. */
  readonly emptyCanvasTapLabel: string;
  /** Compact quick-action bar label choosing Fill/Cover fit. */
  readonly quickBtnCover: string;
  /** Compact quick-action bar label choosing Fit/Contain. */
  readonly quickBtnContain: string;
  /** Compact quick-action bar label rotating +90°. */
  readonly quickBtnRotate: string;
  /** Compact quick-action bar label toggling the text drawer. */
  readonly quickBtnText: string;
  /** Compact quick-action bar label resetting framing. */
  readonly quickBtnReset: string;
  /** Loaded filename readout template containing `{name}` and `{width}`/`{height}`. */
  readonly fileLoadedSummary: string;
  /** Placeholder status before the user selects an image file. */
  readonly noImageLoaded: string;
  /** Accessible description for the interactive circular preview `<canvas>`. */
  readonly previewCanvasAriaLabel: string;
  /** Short hint below the preview explaining drag pan & pinch/wheel zoom. */
  readonly canvasInteractionHint: string;
  /** Fieldset/subheading for pan, zoom, rotate, and background controls. */
  readonly groupAlignment: string;
  /** Quick button fitting the image to fill the entire frame ("Cover"). */
  readonly btnFitCover: string;
  /** Quick button fitting the entire image inside the frame ("Contain"). */
  readonly btnFitContain: string;
  /** Quick button rotating counter-clockwise by 90 degrees. */
  readonly btnRotateLeft: string;
  /** Quick button rotating clockwise by 90 degrees. */
  readonly btnRotateRight: string;
  /** Button restoring default center/scale/zero-rotation alignment. */
  readonly btnResetAlign: string;
  /** Slider label for horizontal X pan offset (`px`). */
  readonly labelOffsetX: string;
  /** Slider label for vertical Y pan offset (`px`). */
  readonly labelOffsetY: string;
  /** Slider label for relative scale multiplier. */
  readonly labelScale: string;
  /** Slider label for fine rotation (`-180°` .. `+180°`). */
  readonly labelRotation: string;
  /** Color input label for canvas fill behind margins / transparent PNGs. */
  readonly labelBgColor: string;
  /** Disclosure summary / heading for optional text overlay. */
  readonly groupTextOverlay: string;
  /** Checkbox enabling or disabling the text overlay layer. */
  readonly labelEnableText: string;
  /** Explains why baking text cleanly into images avoids firmware font bugs. */
  readonly textMotivationTip: string;
  /** Label for multi-line overlay `<textarea>`. */
  readonly labelOverlayText: string;
  /** Label for font-family selector. */
  readonly labelFontFamily: string;
  /** Label for text font size slider (`px`). */
  readonly labelFontSize: string;
  /** Color input label for text fill color. */
  readonly labelTextColor: string;
  /** Color input label for outline stroke color. */
  readonly labelStrokeColor: string;
  /** Slider label for outline stroke thickness (`px`). */
  readonly labelStrokeWidth: string;
  /** Slider label for vertical text position offset (`px`). */
  readonly labelTextOffsetY: string;
  /** Consumer quick-placement label (`Top` / `Center` / `Bottom`). */
  readonly labelTextPositionPreset: string;
  /** Top placement preset button label. */
  readonly posTop: string;
  /** Center placement preset button label. */
  readonly posCenter: string;
  /** Bottom placement preset button label. */
  readonly posBottom: string;
  /** Fieldset/subheading for JPEG encoding budget & SOF0 inspection. */
  readonly groupExport: string;
  /** Checkbox toggling automatic <= 15 KiB quality search. */
  readonly labelAutoOptimize: string;
  /** Slider label for manual JPEG quality (`0.10` .. `1.00`). */
  readonly labelManualQuality: string;
  /** Output byte summary template with `{bytes}` and `{quality}`. */
  readonly outputSizeSummary: string;
  /** Passed validation banner template with `{width}` and `{height}`. */
  readonly validationSof0Ok: string;
  /** Soft warning template when output exceeds 15 KiB (`{bytes}`). */
  readonly warnExceedsTarget: string;
  /** Error text when encoder or input yields Progressive JPEG (`SOF2`). */
  readonly errorProgressiveSof2: string;
  /** Error text when encoded JPEG fails `SOI`/`SOF0` structural inspection. */
  readonly errorInvalidJpeg: string;
  /** Error text when JPEG dimensions differ from device-reported `width x height`. */
  readonly errorDimensionMismatch: string;
  /** Secondary button exporting the composed `240x240` Baseline JPEG locally. */
  readonly btnDownloadJpeg: string;
  /** Primary action button initiating WatchTheme3 BLE transfer. */
  readonly btnUpload: string;
  /** Helpful caption displayed under the Upload button while disconnected explaining auto-reconnect. */
  readonly connectFirstHint: string;
  /** Top-bar title shown on the dedicated Image Select & Send screen. */
  readonly pushScreenTitle: string;
  /** Top-bar badge text shown when previewing/editing images without an active connection. */
  readonly pushStatusOfflineBadge: string;
  /** Top-bar badge text when linked without battery percentage (`{name}`). */
  readonly pushStatusConnectedBadge: string;
  /** Top-bar badge text showing badge name & battery percentage (`{name}`, `{battery}`). */
  readonly pushStatusConnectedBatBadge: string;
  /** Concise condition note displayed near Upload button (`>= 20%`, charger unplugged). */
  readonly pushRuleReminder: string;
  /** Active button label template shown during upload (`{percent}`, `{sent}`, `{total}`). */
  readonly btnUploading: string;
  /** Button label shown while preparing, reconnecting, or queuing a resend before progress arrives. */
  readonly btnPreparingUpload: string;
  /** Log / status announcement shown when automatically resending after a stall (`{attempt}`, `{max}`). */
  readonly uploadRetrying: string;
  /** Completion alert template containing `{bytes}`, `{seconds}`, `{checksum}`. */
  readonly uploadSuccess: string;
  /** Error banner prefix shown when upload or decode fails (`{reason}`). */
  readonly actionError: string;
}

/** Communication log panel strings. */
export interface LogTranslations {
  /** Section heading (`<h2>`) for Panel 3. */
  readonly heading: string;
  /** Button copying all chronological log lines to clipboard. */
  readonly btnCopy: string;
  /** Button clearing the in-memory log console. */
  readonly btnClear: string;
  /** Ephemeral confirmation announcement after copying logs. */
  readonly copiedToast: string;
  /** Empty-state notice inside log viewer. */
  readonly emptyState: string;
}

/** Footer notes and localized WatchTheme3 firmware error descriptions. */
export interface FooterTranslations {
  /** Privacy assurance statement displayed in `<footer>`. */
  readonly privacyGuarantee: string;
  /** Localized descriptions mapped cleanly from BG02 numeric failure codes (`1..9`). */
  readonly dialErrors: Readonly<Record<DialErrorKey, string>>;
  /** Fallback error text when device returns an undocumented numeric status (`{code}`). */
  readonly unknownDialError: string;
}

/** Complete translation schema enforced identically across all locale dictionaries. */
export interface TranslationSchema {
  /** Header copy and browser notices. */
  readonly header: HeaderTranslations;
  /** Home / Top Device List screen copy. */
  readonly home: HomeTranslations;
  /** Device Details & Bluetooth Unpair Guide copy. */
  readonly detail: DeviceDetailTranslations;
  /** BLE connection and telemetry readout copy. */
  readonly connection: ConnectionTranslations;
  /** Circular badge compositor and upload copy. */
  readonly editor: EditorTranslations;
  /** Communication log controls and announcements. */
  readonly logs: LogTranslations;
  /** Footer guarantees and localized firmware error mappings. */
  readonly footer: FooterTranslations;
}
