/**
 * @module i18n/types
 * Strictly typed translation schema preventing missing keys or interpolation typos
 * across all 5 application screens and supported locales.
 */

import type { DialErrorKey } from "../constants/ble";

/** Supported UI languages exposed by BG02 Studio. */
export type LocaleCode = "ja" | "en";

/** Top chrome header, offline indicator, and global capability notice strings. */
export interface HeaderTranslations {
  /** Compact application brand title shown in `<header>`. */
  readonly appTitle: string;
  /** Accessible label for the UI language selector control. */
  readonly languageLabel: string;
  /** Accessible warning banner shown when Web Bluetooth is unavailable. */
  readonly unsupportedBleBanner: string;
  /** PWA offline-cache status badge shown only after scoped precache verification. */
  readonly offlineReadyBadge: string;
  /** Accessible generic back label fallback. */
  readonly btnBack: string;
}

/** Screen 1: Home / Photo entry strings (`activeScreen === "home"`). */
export interface HomeTranslations {
  /** Headline shown before a badge is connected. */
  readonly setupHeading: string;
  /** Opens the photo tools without a Bluetooth connection. */
  readonly btnOffline: string;
  /** Loads the bundled sample photo. */
  readonly btnSample: string;
  /** Opens settings for the displayed badge. */
  readonly btnManage: string;
  /** Accessible label for opening a named badge's settings. */
  readonly manageNamed: string;
  /** Cancels the active reconnect loop from Home. */
  readonly btnCancelReconnect: string;
  /** Short explanation when the browser supports editing only. */
  readonly offlineOnly: string;
  /** First-visit dialog title for initial pairing. */
  readonly guideConnectTitle: string;
  /** First-visit instructions for selecting a badge. */
  readonly guideConnectCopy: string;
  /** First-visit dialog title for choosing a photo. */
  readonly guidePhotoTitle: string;
  /** First-visit instructions for choosing a photo. */
  readonly guidePhotoCopy: string;
  /** Primary page `<h1>` headline ("バッジに写真を送る"). */
  readonly heading: string;
  /** Short 1-line description of what this screen does. */
  readonly lead: string;
  /** Accessible caption describing the empty showcase round-badge illustration. */
  readonly sampleCaption: string;
  /** Label above small current-draft circular thumbnail card when a draft exists. */
  readonly draftCardLabel: string;
  /** Default primary CTA before an image/text draft exists ("写真を選ぶ"). */
  readonly btnPickPhoto: string;
  /** Primary CTA when an active draft already exists ("編集を続ける"). */
  readonly btnContinueEdit: string;
  /** Secondary link/button picking a replacement photo while keeping a draft option. */
  readonly btnReplacePhoto: string;
  /** Optional text-only entry link ("文字だけで作る"). */
  readonly btnTextOnly: string;
  /** Helper navigation button opening Screen 4 My Badges ("マイバッジ"). */
  readonly btnMyBadges: string;
  /** Compact badge count summary shown inside My Badges row (`{count}`). */
  readonly registeredCountBadge: string;
  /** Concise first-time pairing instruction displayed on Home before connecting a badge. */
  readonly guideConnectStep: string;
  /** Prominent action opening the Web Bluetooth picker directly from Home. */
  readonly btnConnectBadge: string;
  /** Compact action retrying connection to a remembered badge from Home. */
  readonly btnReconnectBadge: string;
  /** Connected badge status label on Home (`{name}`). */
  readonly statusConnectedNamed: string;
  /** Connecting status label on Home (`{name}`). */
  readonly statusConnectingNamed: string;
  /** Reconnecting progress label on Home (`{name}`, `{attempt}`, `{max}`). */
  readonly statusReconnectingNamed: string;
  /** Disconnected remembered badge label on Home (`{name}`). */
  readonly statusDisconnectedNamed: string;
  /** Recovery retry button rendered inline inside Home connection failure card. */
  readonly btnRetryConnect: string;
  /** Recovery button reopening Bluetooth picker from Home connection failure card. */
  readonly btnReselectBluetooth: string;
  /** Error alert shown when decoding a chosen file fails while an existing draft is kept intact. */
  readonly imageLoadErrorKeepDraft: string;
  /** Error alert shown when decoding a chosen file fails with no prior draft loaded. */
  readonly imageLoadErrorEmpty: string;
}

/** Screen 2: Adjust & Crop Photo strings (`activeScreen === "editor"`). */
export interface EditorTranslations {
  /** Centered top-bar `<h1/h2>` screen title ("写真を整える"). */
  readonly screenTitle: string;
  /** Back button label returning cleanly to Home. */
  readonly btnBackHome: string;
  /** Placeholder prompt overlaid gently on empty circular preview. */
  readonly emptyCirclePrompt: string;
  /** Accessible `aria-label` describing interactive circular preview canvas. */
  readonly previewCanvasAriaLabel: string;
  /** Concise interaction guidance below circular preview. */
  readonly canvasInteractionHint: string;
  /** Status pill shown while decoding user photo. */
  readonly loadingPhotoStatus: string;
  /** Status pill shown while encoding background JPEG draft. */
  readonly encodingDraftStatus: string;
  /** Compact action changing or selecting photo. */
  readonly btnChangePhoto: string;
  /** Compact action rotating clockwise by 90 degrees. */
  readonly btnRotate90: string;
  /** Compact action opening or focusing badge text editor. */
  readonly btnAddText: string;
  /** Compact action reopening the inline text editor when text already exists. */
  readonly btnEditText: string;
  /** Compact toggle closing/collapsing inline text card once added. */
  readonly btnHideText: string;
  /** Compact reset button shown dynamically whenever edits differ from default framing. */
  readonly btnResetAdjust: string;
  /** Zoom-in toolbar action label. */
  readonly btnZoomIn: string;
  /** Zoom-out toolbar action label. */
  readonly btnZoomOut: string;
  /** Pan-left control label. */
  readonly btnMoveLeft: string;
  /** Pan-right control label. */
  readonly btnMoveRight: string;
  /** Pan-up control label. */
  readonly btnMoveUp: string;
  /** Pan-down control label. */
  readonly btnMoveDown: string;
  /** Primary CTA advancing to Screen 3 ("送信へ"). */
  readonly btnNextSend: string;
  /** Secondary CTA exporting composed JPEG locally ("画像を保存"). */
  readonly btnSaveJpeg: string;
  /** Helper note displayed while both photo and valid text are empty. */
  readonly needContentHint: string;
  /** Heading for inline badge text input card (shown only when enabled). */
  readonly textSectionTitle: string;
  /** Input placeholder example inside multi-line text area. */
  readonly textPlaceholder: string;
  /** Label for text content textarea. */
  readonly labelOverlayText: string;
  /** Action removing text overlay cleanly. */
  readonly btnRemoveText: string;
  /** Collapsed disclosure summary for text font/color/outline options. */
  readonly textStyleDetailsSummary: string;
  /** Label above vertical text position preset buttons (`上`/`中`/`下`). */
  readonly labelTextPositionPreset: string;
  /** Upper third circular placement preset label. */
  readonly posTop: string;
  /** Middle horizontal placement preset label. */
  readonly posCenter: string;
  /** Lower third circular placement preset label. */
  readonly posBottom: string;
  /** Collapsed disclosure summary for sliders & color & quality controls ("細かく調整"). */
  readonly fineAdjustSummary: string;
  /** Cover framing preset label filling the entire circle. */
  readonly btnFitCover: string;
  /** Contain framing preset label showing full rectangular image inside circle. */
  readonly btnFitContain: string;
  /** Counter-clockwise 90-degree rotation button label. */
  readonly btnRotateLeft: string;
  /** Clockwise 90-degree rotation button label. */
  readonly btnRotateRight: string;
  /** Horizontal offset slider label. */
  readonly labelOffsetX: string;
  /** Vertical offset slider label. */
  readonly labelOffsetY: string;
  /** Zoom scale slider label. */
  readonly labelScale: string;
  /** Free-angle rotation slider label. */
  readonly labelRotation: string;
  /** Background matte color input label. */
  readonly labelBgColor: string;
  /** Font family selector label. */
  readonly labelFontFamily: string;
  /** Font size slider label. */
  readonly labelFontSize: string;
  /** Text fill color picker label. */
  readonly labelTextColor: string;
  /** Text outline stroke color picker label. */
  readonly labelStrokeColor: string;
  /** Text outline stroke width slider label. */
  readonly labelStrokeWidth: string;
  /** Text vertical fine-offset slider label. */
  readonly labelTextOffsetY: string;
  /** Toggle label enabling automatic JPEG quality targeting. */
  readonly labelAutoOptimize: string;
  /** Slider label for manual JPEG quality override. */
  readonly labelManualQuality: string;
  /** Collapsed developer/output inspection disclosure ("ファイル形式・サイズの詳細"). */
  readonly outputDetailsSummary: string;
  /** Summary line displaying generated byte length and active quality (`{bytes}`, `{quality}`). */
  readonly outputSizeSummary: string;
  /** Positive badge validation label confirming Baseline SOF0 `240x240` JPEG output. */
  readonly validationSof0Ok: string;
  /** Soft warning shown when encoded JPEG size exceeds recommended badge target. */
  readonly warnExceedsTarget: string;
  /** Validation error shown if Progressive SOF2 encoding is detected. */
  readonly errorProgressiveSof2: string;
  /** Validation error shown if JPEG markers are malformed. */
  readonly errorInvalidJpeg: string;
  /** Validation error shown when dimensions deviate from `240x240` (`{width}`, `{height}`). */
  readonly errorDimensionMismatch: string;
}

/** Screen 3: Send to Badge strings (`activeScreen === "send"`). */
export interface SendTranslations {
  /** Centered screen heading ("バッジに送る"). */
  readonly screenTitle: string;
  /** Back link returning to Editor ("編集に戻る"). */
  readonly btnBackEdit: string;
  /** Small image thumbnail card heading. */
  readonly imageCardHeading: string;
  /** Destination card heading ("送り先"). */
  readonly targetCardHeading: string;
  /** Destination prompt shown when `selectedSendTargetId === null`. */
  readonly stateUnselectedTitle: string;
  /** Brief name shown in the destination row while no badge is selected. */
  readonly unselectedTargetLabel: string;
  /** Primary button opening Web Bluetooth chooser when no destination selected. */
  readonly btnChooseTarget: string;
  /** Secondary link managing saved badges ("マイバッジ"). */
  readonly btnManageBadges: string;
  /** Button switching to another device via chooser ("別のバッジを選ぶ"). */
  readonly btnChooseAnotherBadge: string;
  /** Connecting state headline (`{name}`). */
  readonly stateConnectingTitle: string;
  /** Reconnecting state headline (`{name}`). */
  readonly stateReconnectingTitle: string;
  /** Concise first-time step guidance shown when no badge has been paired yet. */
  readonly firstConnectStepHint: string;
  /** Helper reassurance explaining picker cancel preserves existing link. */
  readonly cancelPickerNote: string;
  /** Connected-ready badge status (`{name}`). */
  readonly stateConnectedTitle: string;
  /** Saved-but-disconnected badge status (`{name}`). */
  readonly stateDisconnectedTargetTitle: string;
  /** Warning note shown when another badge `{other}` is linked while target is `{target}`. */
  readonly otherBadgeLinkedNote: string;
  /** Alert notice shown when browser history navigation invalidated previous target. */
  readonly targetDriftNotice: string;
  /** Concise pre-upload overwrite disclosure placed right above the Send button. */
  readonly replaceCustomSlotNote: string;
  /** Inline button expanding/toggling destination badge switcher options. */
  readonly btnChangeTarget: string;
  /** Preparation status headline shown while async JPEG encode runs before BLE writes. */
  readonly statePreparingTitle: string;
  /** Disabled button label while encoding JPEG before starting BLE transmission. */
  readonly btnPreparingSend: string;
  /** Alert title shown when async preparation aborted due to destination or draft change. */
  readonly statePrepareAbortedTitle: string;
  /** Explanatory copy clarifying zero bytes were written after preparation drift. */
  readonly statePrepareAbortedBody: string;
  /** Connection failure alert headline (`{name}`). */
  readonly stateConnectFailedTitle: string;
  /** Connection failure explanation when cached browser permission is unavailable. */
  readonly connectPermissionUnavailableBody: string;
  /** Recovery button opening Web Bluetooth chooser to re-grant permission. */
  readonly btnReselectBluetooth: string;
  /** Connection failure explanation when GATT link/handshake fails (power/distance). */
  readonly connectGattFailedBody: string;
  /** Recovery button retrying connection after checking badge power and distance. */
  readonly btnRetryPowerRange: string;
  /** Primary CTA when selected target `{name}` is disconnected. */
  readonly btnConnectTarget: string;
  /** Primary CTA when selected target `{name}` is connected & verified. */
  readonly btnSendTarget: string;
  /** Active transfer headline (`{name}`, `{percent}`). */
  readonly stateSendingProgress: string;
  /** Transfer chunk count detail (`{sent}`, `{total}`, `{current}`, `{chunks}`). */
  readonly stateSendingDetail: string;
  /** Automatic retry status line (`{attempt}`, `{max}`). */
  readonly stateRetryingNotice: string;
  /** Post-chunk completion wait headline ("バッジからの完了応答を待っています"). */
  readonly stateAwaitingFinishTitle: string;
  /** Success headline (`{name}`). */
  readonly stateCompletedTitle: string;
  /** Success guidance asking user to verify the badge screen. */
  readonly stateCompletedHint: string;
  /** Primary CTA after completion ("ホームへ"). */
  readonly btnDoneHome: string;
  /** Unexpected drop error headline (`{name}`). */
  readonly stateLinkDroppedTitle: string;
  /** Timeout error headline ("完了を確認できませんでした"). */
  readonly stateTimeoutTitle: string;
  /** Helpful advice after completion timeout or disconnect. */
  readonly stateTimeoutHint: string;
  /** Reconnect & retry CTA preserving exact frozen image bytes. */
  readonly btnReconnectAndRetry: string;
  /** Same-connection retry CTA preserving exact frozen image bytes. */
  readonly btnRetrySameImage: string;
  /** Environment unsupported headline ("この環境ではバッジに接続できません"). */
  readonly unsupportedEnvTitle: string;
  /** Device unsupported headline ("このバッジには送信できません"). */
  readonly unsupportedDeviceTitle: string;
  /** Reason body when badge uses non-JPEG algorithm (`{algo}`). */
  readonly unsupportedAlgorithmReason: string;
  /** Reason body when screen dimensions or format could not be verified. */
  readonly unsupportedUnverifiedReason: string;
  /** Native `<details>` summary revealing supported browser/OS list. */
  readonly viewSupportedEnvSummary: string;
  /** Supported OS & browser guidance text. */
  readonly supportedEnvBody: string;
  /** Refusal headline when badge free flash storage is insufficient. */
  readonly refusalStorageTitle: string;
  /** Refusal headline when battery `< 20%`. */
  readonly refusalBatteryTitle: string;
  /** Refusal headline when charger is plugged in (code `4`). */
  readonly refusalChargingTitle: string;
  /** Advice accompanying capacity shortage refusal. */
  readonly refusalStorageAdvice: string;
  /** Advice accompanying low battery or charging refusal. */
  readonly refusalPowerAdvice: string;
  /** Battery readout label on Send screen (`{percent}`). */
  readonly labelBattery: string;
  /** Free flash storage readout label on Send screen (`{value}`). */
  readonly labelFreeStorage: string;
  /** Fallback string when telemetry value has not yet been verified from hardware. */
  readonly valueUnverified: string;
  /** Button saving JPEG locally from fallback state. */
  readonly btnSaveJpegFallback: string;
  /** Link/button selecting or confirming a saved radio option cleanly. */
  readonly savedTargetsHeading: string;
}

/** Screen 4: My Badges list strings (`activeScreen === "badges"`). */
export interface BadgesTranslations {
  /** Centered screen heading ("マイバッジ"). */
  readonly screenTitle: string;
  /** Back button when opened from Home. */
  readonly btnBackHome: string;
  /** Back button when opened from Send screen. */
  readonly btnBackSend: string;
  /** Single-sentence empty state before any badge is saved. */
  readonly emptyGuide: string;
  /** Concise preparation step hint rendered alongside Add badge. */
  readonly firstConnectStepHint: string;
  /** Recovery button retrying after GATT failure while adding a badge. */
  readonly btnRetryAdd: string;
  /** Primary CTA opening Web Bluetooth chooser to pair a new badge. */
  readonly btnAddBadge: string;
  /** Connected badge status label. */
  readonly statusConnected: string;
  /** Connecting status label. */
  readonly statusConnecting: string;
  /** Reconnecting status label (`{attempt}`, `{max}`). */
  readonly statusReconnecting: string;
  /** Disconnected badge status label. */
  readonly statusDisconnected: string;
  /** Prefix indicating cached telemetry from a prior session ("前回取得"). */
  readonly prefixLastFetched: string;
  /** Battery label when unknown/unread ("未確認"). */
  readonly batteryUnconfirmed: string;
  /** Battery readout (`{percent}`). */
  readonly batteryPercent: string;
  /** Low battery compact indicator (`< 20%`). */
  readonly batteryLowHint: string;
}

/** Screen 5: Badge Details & Diagnostics strings (`activeScreen === "device-detail"`). */
export interface DeviceDetailTranslations {
  /** Centered screen heading ("バッジ詳細"). */
  readonly screenTitle: string;
  /** Back button returning to Screen 4 ("マイバッジ"). */
  readonly btnBackBadges: string;
  /** Fallback notice when focused device was removed or missing. */
  readonly noDeviceSelected: string;
  /** Top status & rename card heading. */
  readonly sectionBasic: string;
  /** Form label above the badge nickname input field. */
  readonly labelNickname: string;
  /** Placeholder text shown inside empty badge nickname input. */
  readonly placeholderNickname: string;
  /** Save button committing a custom badge nickname. */
  readonly btnSaveNickname: string;
  /** Inline confirmation text shown after saving a badge nickname. */
  readonly nicknameSavedNotice: string;
  /** Primary action connecting to the currently viewed saved badge. */
  readonly btnConnect: string;
  /** Secondary action disconnecting the active badge session cleanly. */
  readonly btnDisconnect: string;
  /** Shortcut CTA navigating directly to Screen 3 with this badge pre-selected. */
  readonly btnSendWithBadge: string;
  /** Section heading for automatic reconnection toggle checkboxes. */
  readonly sectionAutoReconnect: string;
  /** Checkbox label enabling exponential-backoff retry after unexpected drops. */
  readonly optAutoRetryOnDrop: string;
  /** Checkbox label enabling silent startup reconnection via `navigator.bluetooth.getDevices()`. */
  readonly optAutoConnectOnStartup: string;
  /** Section heading introducing badge removal from local app registry. */
  readonly sectionUnregister: string;
  /** Button revealing explicit badge-named confirmation dialog. */
  readonly btnUnregisterOpen: string;
  /** Confirmation prompt interpolating the target badge `{name}` before removal. */
  readonly unregisterConfirmQuestion: string;
  /** Destructive confirm button committing removal. */
  readonly btnUnregisterConfirm: string;
  /** Cancel button dismissing the unregister confirmation panel. */
  readonly btnUnregisterCancel: string;
  /** Separate post-forget result notices (`{name}`). */
  readonly removedFromAppNotice: string;
  /** Notice shown when Chrome/Edge `device.forget()` also revoked browser permission. */
  readonly browserPermissionRevokedNotice: string;
  /** Honest notice explaining OS/browser pairing remains when `device.forget()` is unsupported or declined. */
  readonly browserPermissionManualNotice: string;
  /** Collapsed Diagnostics & Unpair Guide disclosure ("接続の診断"). */
  readonly diagnosticsSummary: string;
  /** Button triggering manual refresh of GATT battery, storage, and dial info. */
  readonly btnRefreshTelemetry: string;
  /** Definition-list term for firmware/hardware revisions. */
  readonly labelFirmwareHardware: string;
  /** Definition-list term for reported display geometry & WatchTheme algorithm. */
  readonly labelDisplaySpec: string;
  /** Definition-list term for reported remaining flash storage. */
  readonly labelFreeStorage: string;
  /** Definition-list term for MCH/Main/Customer hardware identifiers. */
  readonly labelModelInfo: string;
  /** Definition-list term for timestamp of last telemetry synchronization. */
  readonly labelLastSynced: string;
  /** Definition-list term for fixed BG02 custom watchface slot (`5538`). */
  readonly labelCustomSlot: string;
  /** Value identifying the fixed custom dial slot (`5538`). */
  readonly valueCustomSlotFixed: string;
  /** Definition-list term for most recent upload byte count, duration, and checksum. */
  readonly labelLastTransfer: string;
  /** Diagnostic telemetry summary of last completed upload (`{bytes}`, `{seconds}`, `{checksum}`). */
  readonly valueLastTransferMeta: string;
  /** Placeholder value shown before any telemetry sync has succeeded. */
  readonly valueNotSynced: string;
  /** Placeholder value shown for unverified hardware fields. */
  readonly valueUnverified: string;
  /** Diagnostic fallback message when `0x20/0x04` storage query times out. */
  readonly freeStorageTimedOut: string;
  /** Subsection heading for advanced Web Bluetooth transport options. */
  readonly sectionBleOptions: string;
  /** Toggle enabling unfiltered `acceptAllDevices: true` scanning fallback. */
  readonly optAcceptAllDevices: string;
  /** Toggle enabling `writeValueWithoutResponse` pacing where supported. */
  readonly optPreferWriteWithoutResponse: string;
  /** Subsection heading introducing browser & OS unpairing instructions. */
  readonly sectionUnpairGuide: string;
  /** Reference internal Chrome URL string shown in unpair instructions. */
  readonly unpairChromeUrl: string;
  /** Button copying `chrome://bluetooth-internals/#devices` to clipboard. */
  readonly btnCopyChromeUrl: string;
  /** Feedback label briefly shown after copying the internal Chrome URL. */
  readonly copiedChromeUrlToast: string;
  /** Instruction paragraph explaining Chrome/Edge browser device permission cleanup. */
  readonly unpairStepBrowserBody: string;
  /** OS-specific Bluetooth removal guide for Windows. */
  readonly unpairStepWindows: string;
  /** OS-specific Bluetooth removal guide for Android. */
  readonly unpairStepAndroid: string;
  /** OS-specific Bluetooth removal guide for macOS / iPadOS. */
  readonly unpairStepApple: string;
}

/** Communication log panel strings inside Diagnostics disclosure. */
export interface LogTranslations {
  /** Heading inside Diagnostics (`<h3>`). */
  readonly heading: string;
  /** Button copying all diagnostic log entries to clipboard. */
  readonly btnCopy: string;
  /** Button clearing retained in-memory log entries. */
  readonly btnClear: string;
  /** Confirmation feedback displayed after copying logs. */
  readonly copiedToast: string;
  /** Empty placeholder text shown before any BLE commands have executed. */
  readonly emptyState: string;
}

/** Footer copy and localized WatchTheme3 firmware error descriptions. */
export interface FooterTranslations {
  /** Accurate local-processing privacy statement. */
  readonly privacyGuarantee: string;
  /** Localized descriptions mapped cleanly from BG02 numeric failure codes (`1..9`). */
  readonly dialErrors: Readonly<Record<DialErrorKey, string>>;
  /** Fallback error text when device returns an undocumented numeric status (`{code}`). */
  readonly unknownDialError: string;
}

/** Complete translation schema enforced identically across all locale dictionaries. */
export interface TranslationSchema {
  /** Top navigation chrome & capability banner strings. */
  readonly header: HeaderTranslations;
  /** Screen 1 (Home) strings. */
  readonly home: HomeTranslations;
  /** Screen 2 (Photo Editor) strings. */
  readonly editor: EditorTranslations;
  /** Screen 3 (Send to Badge) strings. */
  readonly send: SendTranslations;
  /** Screen 4 (My Badges) strings. */
  readonly badges: BadgesTranslations;
  /** Screen 5 (Badge Details & Diagnostics) strings. */
  readonly detail: DeviceDetailTranslations;
  /** Communication log controls & empty state strings. */
  readonly logs: LogTranslations;
  /** Footer privacy notice & WatchTheme3 numeric error messages. */
  readonly footer: FooterTranslations;
}
