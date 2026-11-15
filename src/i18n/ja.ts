/**
 * @module i18n/ja
 * Japanese localization dictionary verified at compile time against {@link TranslationSchema}.
 */

import type { TranslationSchema } from "./types";

/** Complete Japanese (`ja`) translation dictionary for BG02 Studio. */
export const jaDictionary: TranslationSchema = {
  header: {
    appTitle: "BG02 Studio",
    appSubtitle: "画像を丸く整えてバッジへ送る（完全ローカル動作）",
    languageLabel: "言語",
    unsupportedBleBanner:
      "このブラウザは Web Bluetooth に対応していません。Desktop / Android 版 Chrome または Edge（HTTPS / localhost）で開いてください。",
    offlineReadyBadge: "オフライン利用可",
    btnBack: "戻る",
  },
  home: {
    screenHeading: "マイバッジ",
    welcomeTitle: "BG02 バッジに画像を送ってみましょう",
    welcomeLead: "はじめての方でも 3 ステップでかんたんに画面を切り替えられます。",
    welcomeStep1: "1. BG02 本体の電源を入れる（充電ケーブルは外してください）",
    welcomeStep2: "2. 下の「BG02 を追加・接続」を押して端末を選ぶ",
    welcomeStep3: "3. 登録された端末を押して画像を選び、送信する",
    btnConnectNew: "＋ 新しい BG02 を接続・追加",
    btnOpenOfflineEditor: "接続せずに画像だけ試作する",
    btnOpenOfflineEditorDesc: "写真を選んで丸枠に合わせるプレビューを先に確認できます",
    btnOpenUnpairGuide: "端末情報・ペアリング解除の方法",
    btnOpenUnpairGuideDesc: "本体スペックの確認、登録解除・Bluetooth 解除手順はこちら",
    cardActionConnectAndSend: "接続して画像を送る",
    cardActionSend: "画像を選ぶ・送信",
    cardActionDetail: "詳細・解除",
    batteryNoteLow: "20%未満・要充電",
    batteryRuleFooter:
      "※ 端末へ送信するには、バッテリー残量 20% 以上・充電ケーブルを外した状態が必要です。",
    sectionDevices: "登録済みのバッジ",
    sectionMoreActions: "その他・ガイド",
  },
  detail: {
    screenTitle: "端末の詳細・ペアリング解除",
    sectionStatus: "接続状況と設定",
    sectionSpecs: "端末情報（スペック）",
    sectionUnpair: "Bluetooth ペアリング解除の方法",
    sectionDeveloper: "開発者向け設定・通信ログ",
    noDeviceSelectedTitle: "選択されている端末がありません",
    noDeviceSelectedHint:
      "トップ画面から BG02 を接続するか、下のガイドに従ってブラウザ／OS の Bluetooth 登録を解除できます。",
    btnSendWithThisDevice: "この端末に画像を送る",
    cachedInfoBadge: "前回接続時の情報",
    lastSyncedLabel: "最終接続",
    lastSyncedNever: "未接続",
    unpairIntro:
      "Web Bluetooth の仕組み上、アプリの一覧から消しただけでは PC やスマホ本体の Bluetooth 登録（ペアリング）が残る場合があります。完全に切り離すときは次の手順で行ってください。",
    unpairStep1Title: "Step 1: アプリとブラウザの記憶を解除する",
    unpairStep1Body:
      "下のボタンを押すと、このアプリの一覧から削除し、対応ブラウザ（PC 版 Chrome / Edge 等）ではサイトの接続許可も取り消します。",
    btnForgetThisBadge: "この端末を削除・ブラウザ記憶を解除",
    forgetResultBrowserRevoked:
      "「{name}」を一覧から削除し、ブラウザの接続許可も解除しました。OS 側の登録も消す場合は Step 3 を行ってください。",
    forgetResultLocalOnly:
      "「{name}」をアプリの一覧から削除しました。このブラウザでは自動許可取消に非対応のため、必要に応じて Step 2・3 を行ってください。",
    unpairStep2Title: "Step 2: ブラウザの Bluetooth 許可をリセットする",
    unpairStep2Body:
      "アドレスバー左のアイコン（鍵／設定マーク）→「Bluetooth」の許可を取り消すか、Chrome / Edge の設定ページから削除してください。",
    unpairChromeUrl: "chrome://settings/content/bluetoothDevices",
    btnCopyChromeUrl: "設定アドレスをコピー",
    copiedChromeUrlToast: "Chrome / Edge の設定アドレスをコピーしました。",
    unpairStep3Title: "Step 3: スマホ・PC 本体（OS）の Bluetooth 設定から削除",
    unpairStep3Windows:
      "Windows 11 / 10:「設定」→「Bluetooth とデバイス」→「デバイス」→ 該当の BG02 の「⋮」→「デバイスの削除」",
    unpairStep3Android:
      "Android:「設定」→「接続済みのデバイス」→ 該当の BG02 横の歯車アイコン →「削除（ペアリング解除）」",
    unpairStep3Apple:
      "Mac / iPhone (Bluefy 等):「設定 / システム設定」→「Bluetooth」→ BG02 横の「i / 詳細」→「このデバイスの登録を解除」",
  },
  connection: {
    heading: "1. バッジ接続",
    btnConnect: "BG02 に接続",
    btnChangeDevice: "別の端末を選ぶ",
    btnReconnect: "再接続",
    btnDisconnect: "切断",
    btnRefreshTelemetry: "端末情報を再取得",
    optAcceptAllDevices:
      "すべての BLE デバイスを表示（BG02 がアドバタイズに UUID を含めない場合）",
    optPreferWriteWithoutResponse:
      "高速書き込み (WriteWithoutResponse + 6ms間隔) を優先する",
    statusDisconnected: "未接続",
    statusConnecting: "接続中…",
    statusReconnecting: "再接続中 ({attempt}/{max})…",
    statusConnected: "接続済み",
    statusUploading: "転送中…",
    statusError: "接続エラー",
    deviceShelfHeading: "登録済みバッジ（タップで切替・接続）",
    deviceEmptyHint:
      "まだバッジが登録されていません。「BG02 に接続」から 1 つ目をペアリングするとここに保存されます。",
    btnAddDevice: "＋ 新しい BG02 を追加",
    btnCancelReconnect: "再接続を中止",
    optAutoRetryOnDrop: "切断時に自動で再接続を試みる（最大3回）",
    optAutoConnectOnStartup: "起動時に前回のバッジへ自動接続を試みる",
    deviceReadyBadge: "即接続可",
    devicePairRequiredBadge: "要再選択",
    btnRenameDevice: "名前を変更",
    btnSaveNickname: "保存",
    btnCancelRename: "中止",
    btnForgetDevice: "削除",
    renamePlaceholder: "例: バッグ用・イベント用",
    reconnectingNotice:
      "通信が切断されたため「{name}」へ自動再接続中 ({attempt}/{max})…",
    deviceNeedsRepairNotice:
      "「{name}」のブラウザ許可ハンドルを更新するため、Bluetooth 選択画面を開きます。",
    heroDisconnectedSubtitle: "Bluetooth で接続してバッジに画像を送れます",
    funcBadgesTitle: "登録済みバッジ管理・自動再接続",
    funcLogsTitle: "端末詳細・BLE設定・通信ログ",
    labelBattery: "バッテリー",
    batteryLowWarning: "要充電 (<20%)",
    labelFirmwareHardware: "FW / HW リビジョン",
    labelDisplaySpec: "画面仕様 / 形式",
    labelFreeStorage: "空きフラッシュ容量",
    labelModelInfo: "MCU / カスタマー / 製造元",
    valueNotRead: "未取得",
    freeStorageTimedOut: "取得タイムアウト（5000ms・転送は実行可能）",
    advancedDrawerSummary: "詳細設定・端末情報・通信ログ（開発者 / トラブル時向け）",
    sectionFunctionHeading: "機能・詳細設定",
  },
  editor: {
    heading: "2. バッジ画像をつくる",
    dropzonePrompt:
      "画像をドロップ、またはボタンを押して選択",
    btnSelectFile: "写真・画像",
    btnTakePhoto: "カメラ",
    sectionSelectImage: "画像を選ぶ・調整",
    cropSizeSummary: "生成サイズ: {kb} KB",
    remainingSpaceSummary: "端末の残り容量: {space}",
    btnRefreshShort: "更新",
    funcFineEditTitle: "位置微調整・文字入れ設定",
    funcExportTitle: "JPEG 画質調整・ファイル保存",
    emptyCanvasTapLabel: "＋ 写真を選ぶ",
    quickBtnCover: "埋める",
    quickBtnContain: "全体",
    quickBtnRotate: "90°回転",
    quickBtnText: "文字",
    quickBtnReset: "戻す",
    fileLoadedSummary: "{name}（{width}×{height} px）",
    noImageLoaded:
      "背景色や文字だけのバッジも作成できます",
    previewCanvasAriaLabel:
      "BG02 円形ディスプレイ向けプレビュー（ドラッグで移動、ピンチやホイールで拡大縮小）",
    canvasInteractionHint:
      "指・マウスでドラッグして位置調整、2本指ピンチやホイールで拡大縮小できます。",
    groupAlignment: "位置・倍率・背景色の詳細微調整",
    btnFitCover: "円枠いっぱい (Cover)",
    btnFitContain: "全体を収める (Contain)",
    btnRotateLeft: "-90° 回転",
    btnRotateRight: "+90° 回転",
    btnResetAlign: "配置をリセット",
    labelOffsetX: "左右位置 (X)",
    labelOffsetY: "上下位置 (Y)",
    labelScale: "拡大・縮小",
    labelRotation: "回転角度",
    labelBgColor: "背景色",
    groupTextOverlay: "文字を入れる（任意）",
    labelEnableText: "画像の上にテキストを表示する",
    textMotivationTip:
      "※ 本体設定では日本語の文字化け・欠落が起きるため、画像内に文字を描画すると綺麗に固定表示できます。",
    labelOverlayText: "表示文字（改行可）",
    labelFontFamily: "フォント",
    labelFontSize: "文字サイズ (px)",
    labelTextColor: "文字色",
    labelStrokeColor: "縁取り色",
    labelStrokeWidth: "縁取り太さ (px)",
    labelTextOffsetY: "文字の上下微調整 (Y)",
    labelTextPositionPreset: "文字の配置",
    posTop: "上",
    posCenter: "中央",
    posBottom: "下",
    groupExport: "JPEG 自動最適化・SOF0 技術検証",
    labelAutoOptimize: "自動最適化（15 KiB 以下を目標に画質自動調整）",
    labelManualQuality: "手動 JPEG 画質",
    outputSizeSummary: "生成サイズ: {bytes} バイト（JPEG 品質 {quality}）",
    validationSof0Ok: "検証 OK: Baseline JPEG (SOF0) / {width}×{height} px",
    warnExceedsTarget:
      "注意: 15 KiB 目安を超えています（{bytes} B）。転送に時間がかかる場合があります。",
    errorProgressiveSof2:
      "非対応形式: Progressive JPEG (SOF2) は BG02 実機で拒否されます。",
    errorInvalidJpeg:
      "JPEG 検証エラー: Baseline JPEG (SOF0) 形式として検証できませんでした。",
    errorDimensionMismatch:
      "解像度不一致: 実機要件 {expectedW}×{expectedH} に対し {actualW}×{actualH} px です。",
    btnDownloadJpeg: "生成 JPEG を保存",
    btnUpload: "BG02 に送信する",
    connectFirstHint: "未接続です。「BG02 に送信する」を押すと接続確認・再接続のうえで送信します",
    pushScreenTitle: "画像の選択と送信",
    pushStatusOfflineBadge: "オフライン試作中（送信時に接続）",
    pushStatusConnectedBadge: "{name} · 接続中",
    pushStatusConnectedBatBadge: "{name} · 電池 {battery}%",
    pushRuleReminder: "※ バッテリー 20% 以上・充電ケーブルを外した状態で送信してください",
    btnUploading: "送信中… {percent}%",
    btnPreparingUpload: "送信準備・再接続中…",
    uploadRetrying: "送信が停止したため自動で再送信します… ({attempt}/{max}回目)",
    uploadSuccess:
      "送信完了しました！バッジの画面をご確認ください（{seconds} 秒）。",
    actionError: "エラー: {reason}",
  },
  logs: {
    heading: "通信ログ",
    btnCopy: "ログをコピー",
    btnClear: "クリア",
    copiedToast: "通信ログをクリップボードにコピーしました。",
    emptyState: "ログはまだありません。",
  },
  footer: {
    privacyGuarantee:
      "外部サーバー通信・解析トラッカーは一切ありません。画像と通信はお使いの端末内で完結します。",
    dialErrors: {
      checksumMismatch: "検証エラー・チェックサム不一致 (コード 1 / 1003)",
      lowBattery:
        "バッジ本体のバッテリー残量が 20% 未満のため転送できません。充電ケーブルで 20% 以上まで充電し、ケーブルを外してから再度お試しください (コード 3 / 1008)",
      deviceCharging:
        "バッジ本体が充電中のため転送が拒否されました。充電ケーブル（USB 電源）を外し、バッテリー 20% 以上の状態で再度お試しください (コード 4 / 1009)",
      storageFull:
        "端末の空き容量が不足しています。古い文字盤／画像を削除するか JPEG 画質を下げてから再度お試しください (コード 5 / 1010)",
      themeLimitExceeded:
        "端末の文字盤保存上限に達しています。不要な文字盤を削除してから再度お試しください (コード 6 / 1011)",
      duplicateUpgrade:
        "重複更新として端末に拒否されました。少し待つか画像を変更して再度お試しください (コード 7 / 1012)",
      themeIdNotFound: "対象の文字盤 ID が端末に見つかりません (コード 8 / 1013)",
      upgradeTooFrequent:
        "更新頻度が高すぎるため一時的に拒否されました。数秒待ってから再度お試しください (コード 9 / 1015)",
    },
    unknownDialError: "不明な端末エラーコード ({code})",
  },
};
