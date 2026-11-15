/**
 * @module i18n/en
 * English localization dictionary verified at compile time against {@link TranslationSchema}.
 */

import type { TranslationSchema } from "./types";

/** Complete English (`en`) translation dictionary for BG02 Studio. */
export const enDictionary: TranslationSchema = {
  header: {
    appTitle: "BG02 Studio",
    appSubtitle: "Frame circular photos & send to BG02 (100% local)",
    languageLabel: "Language",
    unsupportedBleBanner:
      "Web Bluetooth API is not available in this browser. Open BG02 Studio in Chrome or Edge (Desktop / Android) via HTTPS or localhost.",
    offlineReadyBadge: "Offline Ready",
    btnBack: "Back",
  },
  home: {
    screenHeading: "My Badges",
    welcomeTitle: "Send an image to your BG02 badge",
    welcomeLead: "Switch watch-badge photos easily in 3 beginner-friendly steps.",
    welcomeStep1: "1. Power on your BG02 badge (unplug USB charging cable first).",
    welcomeStep2: "2. Tap \"Add / Connect BG02\" below to choose your badge.",
    welcomeStep3: "3. Select your badge card to crop an image and send.",
    btnConnectNew: "+ Add / Connect BG02",
    btnOpenOfflineEditor: "Try Image Editor Without Device",
    btnOpenOfflineEditorDesc: "Preview circular framing and text overlays before connecting",
    btnOpenUnpairGuide: "Device Info & How to Unpair Bluetooth",
    btnOpenUnpairGuideDesc: "View badge specs, communication log, and unpairing instructions",
    cardActionConnectAndSend: "Connect & Send Image",
    cardActionSend: "Select & Send Image",
    cardActionDetail: "Details / Unpair",
    batteryNoteLow: "Below 20% — charge first",
    batteryRuleFooter:
      "Tip: Transfers require badge battery >= 20% with charging cable unplugged.",
    sectionDevices: "Registered Badges",
    sectionMoreActions: "Help & Unpairing",
  },
  detail: {
    screenTitle: "Device Details & Unpair",
    sectionStatus: "Connection & Controls",
    sectionSpecs: "Device Specifications",
    sectionUnpair: "How to Unpair Bluetooth",
    sectionDeveloper: "Developer Options & Logs",
    noDeviceSelectedTitle: "No badge selected",
    noDeviceSelectedHint:
      "Connect a BG02 badge from Home, or follow the guide below to reset browser or OS Bluetooth pairings.",
    btnSendWithThisDevice: "Send Image to This Badge",
    cachedInfoBadge: "Cached Info",
    lastSyncedLabel: "Last Connected",
    lastSyncedNever: "Not yet connected",
    unpairIntro:
      "By Web Bluetooth design, removing a badge inside a web app may leave the OS Bluetooth bond active. Follow these steps when completely unpairing a badge.",
    unpairStep1Title: "Step 1: Remove from app & revoke browser permission",
    unpairStep1Body:
      "Click below to delete this badge from your saved list and invoke device.forget() where supported (Desktop Chrome / Edge).",
    btnForgetThisBadge: "Remove Badge & Forget Browser Permission",
    forgetResultBrowserRevoked:
      "Removed \"{name}\" and revoked browser permission. Check Step 3 to remove the OS Bluetooth bond too.",
    forgetResultLocalOnly:
      "Removed \"{name}\" from app list. Complete Steps 2 and 3 below if your browser does not support device.forget().",
    unpairStep2Title: "Step 2: Reset browser Bluetooth permission",
    unpairStep2Body:
      "Open the site controls icon in your browser address bar and revoke Bluetooth, or remove it in Chrome/Edge site settings.",
    unpairChromeUrl: "chrome://settings/content/bluetoothDevices",
    btnCopyChromeUrl: "Copy Settings URL",
    copiedChromeUrlToast: "Copied Chrome/Edge Bluetooth settings path.",
    unpairStep3Title: "Step 3: Remove pairing in OS Bluetooth Settings",
    unpairStep3Windows:
      "Windows 11 / 10: Settings -> Bluetooth & devices -> Devices -> '...' next to BG02 -> Remove device.",
    unpairStep3Android:
      "Android: Settings -> Connected devices -> gear icon next to BG02 -> Forget device.",
    unpairStep3Apple:
      "Mac / iPhone (Bluefy etc.): Settings -> Bluetooth -> 'i' icon beside BG02 -> Forget This Device.",
  },
  connection: {
    heading: "1. Badge Connection",
    btnConnect: "Connect BG02",
    btnChangeDevice: "Switch Device",
    btnReconnect: "Reconnect",
    btnDisconnect: "Disconnect",
    btnRefreshTelemetry: "Refresh Telemetry",
    optAcceptAllDevices:
      "Show all BLE devices (required when BG02 omits service UUIDs from advertisements)",
    optPreferWriteWithoutResponse:
      "Prefer fast WriteWithoutResponse (+6 ms chunk pacing)",
    statusDisconnected: "Disconnected",
    statusConnecting: "Connecting...",
    statusReconnecting: "Retrying ({attempt}/{max})...",
    statusConnected: "Connected",
    statusUploading: "Uploading...",
    statusError: "Connection Error",
    deviceShelfHeading: "Saved Badges (tap to connect or switch)",
    deviceEmptyHint:
      "No badges saved yet. Pair your first BG02 above to unlock 1-tap switching and nicknames.",
    btnAddDevice: "+ Add BG02",
    btnCancelReconnect: "Stop Retry",
    optAutoRetryOnDrop: "Auto-retry on unexpected drop (up to 3x)",
    optAutoConnectOnStartup: "Auto-connect to last badge on startup",
    deviceReadyBadge: "Ready",
    devicePairRequiredBadge: "Select",
    btnRenameDevice: "Rename badge",
    btnSaveNickname: "Save",
    btnCancelRename: "Cancel",
    btnForgetDevice: "Remove badge",
    renamePlaceholder: "Nickname (e.g. Backpack)",
    reconnectingNotice:
      "Connection lost. Reconnecting to \"{name}\" ({attempt}/{max})...",
    deviceNeedsRepairNotice:
      "Browser handle for \"{name}\" refreshed via chooser—select the badge to reconnect.",
    heroDisconnectedSubtitle: "Connect a BG02 badge via Bluetooth to push images",
    funcBadgesTitle: "Saved Badges & Auto-Reconnect",
    funcLogsTitle: "Device Info, BLE Options & Logs",
    labelBattery: "Battery",
    batteryLowWarning: "Low (<20%)",
    labelFirmwareHardware: "FW / HW Revision",
    labelDisplaySpec: "Display Spec / Codec",
    labelFreeStorage: "Free Flash Storage",
    labelModelInfo: "MCU / Customer / OEM",
    valueNotRead: "Not read",
    freeStorageTimedOut: "Query timed out (5000 ms; uploads still work)",
    advancedDrawerSummary: "Advanced Settings, Telemetry & Debug Logs",
    sectionFunctionHeading: "Function",
  },
  editor: {
    heading: "2. Create Badge Image",
    dropzonePrompt:
      "Drop an image here, or tap to choose a photo",
    btnSelectFile: "Gallery",
    btnTakePhoto: "Camera",
    sectionSelectImage: "Select Image & Tools",
    cropSizeSummary: "Image crop size: {kb} KB",
    remainingSpaceSummary: "Device remaining space: {space}",
    btnRefreshShort: "Refresh",
    funcFineEditTitle: "Fine Alignment & Text Overlay",
    funcExportTitle: "JPEG Quality & Local Export",
    emptyCanvasTapLabel: "+ Choose Photo",
    quickBtnCover: "Fill",
    quickBtnContain: "Fit",
    quickBtnRotate: "Rotate 90°",
    quickBtnText: "Text",
    quickBtnReset: "Reset",
    fileLoadedSummary: "{name} ({width}x{height} px)",
    noImageLoaded:
      "No photo yet (background color & text-only cards also work)",
    previewCanvasAriaLabel:
      "BG02 circular display preview (drag to pan, pinch or scroll to zoom)",
    canvasInteractionHint:
      "Drag to move, pinch with two fingers or scroll wheel to zoom.",
    groupAlignment: "Fine Position, Scale & Background Controls",
    btnFitCover: "Fill Circle (Cover)",
    btnFitContain: "Fit Whole Image (Contain)",
    btnRotateLeft: "Rotate -90°",
    btnRotateRight: "Rotate +90°",
    btnResetAlign: "Reset Alignment",
    labelOffsetX: "Pan X",
    labelOffsetY: "Pan Y",
    labelScale: "Zoom",
    labelRotation: "Rotation",
    labelBgColor: "Background",
    groupTextOverlay: "Optional Text Overlay",
    labelEnableText: "Show text over the image",
    textMotivationTip:
      "Tip: Built-in device language menus can drop or mangle Japanese glyphs; burning text into the badge photo renders crisply.",
    labelOverlayText: "Overlay Text (multiline)",
    labelFontFamily: "Font",
    labelFontSize: "Font Size (px)",
    labelTextColor: "Text Color",
    labelStrokeColor: "Outline Color",
    labelStrokeWidth: "Outline Width (px)",
    labelTextOffsetY: "Text Vertical Offset (Y)",
    labelTextPositionPreset: "Text Position",
    posTop: "Top",
    posCenter: "Center",
    posBottom: "Bottom",
    groupExport: "JPEG Auto-Optimization & SOF0 Inspection",
    labelAutoOptimize: "Auto-optimize quality (target <= 15 KiB)",
    labelManualQuality: "Manual JPEG Quality",
    outputSizeSummary: "Output size: {bytes} bytes (JPEG quality {quality})",
    validationSof0Ok: "Verified: Baseline JPEG (SOF0) / {width}x{height} px",
    warnExceedsTarget:
      "Notice: output exceeds 15 KiB target ({bytes} B); BLE transfer may take longer.",
    errorProgressiveSof2:
      "Unsupported format: Progressive JPEG (SOF2) is rejected by BG02 firmware.",
    errorInvalidJpeg:
      "JPEG validation error: payload is not a valid Baseline JPEG (SOF0).",
    errorDimensionMismatch:
      "Dimension mismatch: badge expects {expectedW}x{expectedH}, got {actualW}x{actualH} px.",
    btnDownloadJpeg: "Save Generated JPEG",
    btnUpload: "Send to BG02",
    connectFirstHint:
      "Not connected — pressing \"Send to BG02\" checks and reconnects before sending",
    pushScreenTitle: "Single image push",
    pushStatusOfflineBadge: "Offline Preview (connects on send)",
    pushStatusConnectedBadge: "{name} · Connected",
    pushStatusConnectedBatBadge: "{name} · Battery {battery}%",
    pushRuleReminder: "Requires >= 20% battery & charging cable unplugged",
    btnUploading: "Sending... {percent}%",
    btnPreparingUpload: "Preparing / reconnecting...",
    uploadRetrying: "Transfer stalled — automatically resending... (attempt {attempt}/{max})",
    uploadSuccess:
      "Sent! Check your BG02 screen ({seconds} s).",
    actionError: "Error: {reason}",
  },
  logs: {
    heading: "Communication Log",
    btnCopy: "Copy Log",
    btnClear: "Clear",
    copiedToast: "Communication log copied to clipboard.",
    emptyState: "No log entries yet.",
  },
  footer: {
    privacyGuarantee:
      "Zero external servers or analytics. Photos and BLE traffic stay strictly local on your device.",
    dialErrors: {
      checksumMismatch: "Verification error / checksum mismatch (code 1 / 1003)",
      lowBattery:
        "Badge battery is below 20% and cannot flash images. Charge to >= 20%, unplug the charger, and try again (code 3 / 1008)",
      deviceCharging:
        "Upload rejected while badge is charging. Unplug the USB charger (with battery >= 20%) and try again (code 4 / 1009)",
      storageFull:
        "Insufficient storage on badge. Delete old watch faces or reduce JPEG quality and try again (code 5 / 1010)",
      themeLimitExceeded:
        "Watch face storage limit exceeded on badge. Delete an existing face and try again (code 6 / 1011)",
      duplicateUpgrade:
        "Duplicate upgrade rejected by firmware. Wait briefly or edit the image and retry (code 7 / 1012)",
      themeIdNotFound: "Watch face ID not found on device (code 8 / 1013)",
      upgradeTooFrequent:
        "Upgrade requests are too frequent. Wait a few seconds and try again (code 9 / 1015)",
    },
    unknownDialError: "Unknown device error code ({code})",
  },
};
