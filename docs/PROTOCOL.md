# BG02 BLE プロトコル技術ノート

本資料は、実機 `BG02`（DIS: `manufacturer = "LJ733_V1_BadgeOK"`, `firmwareRevision = "V35922"`, `hardwareRevision = "LJ733_MB_V1.5"`）との BLE 通信実測およびコンパニオン仕様調査で確認されたプロトコルの要点をまとめたものです。

---

## 1. GATT サービス & キャラクタリスティック

| 役割 | UUID | 備考 |
| :--- | :--- | :--- |
| Primary Service (Vendor) | `7e400001-b5a3-f393-e0a9-e50e24dcca9d` | Nordic UART 派生カスタム UUID |
| Write Characteristic | `7e400002-b5a3-f393-e0a9-e50e24dcca9d` | `write` / `writeWithoutResponse` |
| Notify 1 (RX Primary) | `7e400003-b5a3-f393-e0a9-e50e24dcca9d` | コマンド応答 (`0xCD`) |
| Notify 2 (RX Secondary) | `7e400004-b5a3-f393-e0a9-e50e24dcca9d` | **必ず両方 Notify 購読する** |
| Battery Service | `0000180f-0000-1000-8000-00805f9b34fb` | Battery Level `0x2a19` |
| Device Information Service | `0000180a-0000-1000-8000-00805f9b34fb` | Model `0x2a24`, FW `0x2a26`, HW `0x2a27`, SW `0x2a28`, Manufacturer `0x2a29` |

### 接続時の重要事項（なぜ切断を防げるか）
- `7e400003` と `7e400004` の両方を購読した直後に、ハンドシェイクフレーム `CD 00 06 12 01 0A 00 01 02` を送信する必要があります。未購読・未送信のまま数秒経過すると、端末側から約 6 秒程度で GATT 切断される現象が実機で観測されています。
- BLE 書き込みは **20 バイト単位（ATT デフォルト MTU 23 のペイロード上限）** に分割し、単一のシリアルキューから順次送信します。

---

## 2. フレーム構造と必須 ACK

### コマンドフレーム (`0xCD`)
```
[0xCD] [lenHi] [lenLo] [cmdId] [0x01] [subCmd] [pLenHi] [pLenLo] [...payload]
```
- `len = (lenHi << 8) | lenLo = payload.length + 5`（フレーム全長 - 3）
- ペイロード無し: `CD 00 05 <cmdId> 01 <subCmd> 00 00`

### 応答確認 ACK フレーム (`0xDC`) — 受信時必須
端末から `0xCD` フレームを受信すると、受信側（アプリ）から以下の 8 バイト ACK を即座に返送する必要があります。ACK を返さない場合、端末側が再送やタイムアウト扱いとなり後続コマンドが進行しません。

```
[0xDC] [0x00] [0x05] [cmdId] [cmdKey] [rxFrameLenHi] [rxFrameLenLo] [0x01]
```
- `rxFrameLen`: 受信した `0xCD` フレーム全体のバイト長（`((rx[1] << 8) | rx[2]) + 3`）
- ※ `0x1F` チャンク送信中の場合、プロトコルレイヤは `cmdId=0x20, cmdKey=0x01` 等の通知も受け取るため、**ACK 返送自体が優先的に完了すること**が重要です。

---

## 3. 実機確認済みコマンド一覧

| 機能 | 送信 (`App -> BG02`) | 応答 (`BG02 -> App`) | 実機結果例 |
| :--- | :--- | :--- | :--- |
| ペアリング / 接続確立 | `CD 00 06 12 01 0A 00 01 02` | `DC` ACK | 即時 ACK 返却 |
| 文字盤 / 画面情報取得 | `CD 00 05 20 01 02 00 00` | `cmd=0x20, sub=0x02` | `240×240`, `round`, `algorithm=4 (JPEG)`, `pkg=5000B` |
| 空きストレージ取得 | `CD 00 05 20 01 04 00 00` | `cmd=0x20, sub=0x04` (uint64 BE) | `356352 bytes` |
| 画像転送開始 (`WatchTheme3`) | `cmd=0x1F, sub=0x02` (17B) | `cmd=0x20, sub=0x01` (`code=1000`) | 下記参照 |
| 画像データチャンク | `cmd=0x1F, sub=0x01` | `cmd=0x20, sub=0x01` (`code=1000+seq`) | 1-based シーケンス |
| 画像転送完了 | `cmd=0x1F, sub=0x03` (4B) | `cmd=0x20, sub=0x01` (`code=2`) | `code=2` で完了 |
| 転送ステータス照会 (`Lqm2.h`) | `CD 00 05 20 01 01 00 00` | `cmd=0x20, sub=0x01` (`code`) | 完了応答遅延時の確認に使用 |

---

## 4. 画像転送 (`WatchTheme3`) と JPEG 要件

### ペイロード構成
1. 本体バッファ `o = [uint32_be(imageBytes.length), ...imageBytes]`
2. 開始コマンド `0x1F/0x02`（17 バイト）:
   - `[0..3]`: `watchId` (`5538` = `0x000015A2`, カスタム固定スロット)
   - `[4]`: `fileType`（`2` = JPEG, `0` = JieLi BMP `.bin`, `1` = MJPEG AVI 動画）
   - `[5]`: `cfgMask = 0x08`
   - `[6..8]`: `[0x00, 0x00, 0x00]`
   - `[9..12]`: `uint32_be(o.length)`
   - `[13..16]`: `[0x00, 0x00, 0x00, 0x00]`
3. チャンクコマンド `0x1F/0x01`:
   - 最大 `effectiveChunk` バイト（実機報告 `5000B`）ごとに分割。
   - `inner = [uint16_be(seq1Based), ...slice]`
   - `chunkSum = byteSum32(inner)`（CRC-32 ではなく **符号なし 32bit バイト単純総和**）
   - payload = `[...inner, uint32_be(chunkSum)]`
4. 完了コマンド `0x1F/0x03`（4 バイト）:
   - `[uint32_be(byteSum32(o))]`

### 実機検証で判明した運用・タイミング上の注意（重要な実装知識）
1. **Baseline JPEG (`SOF0`) 必須**:
   - Progressive JPEG (`SOF2`, `0xFF 0xC2`) は端末側デコーダ非対応となるため、事前にマーカー解析を行い **`SOF0` (`0xFF 0xC0`)** かつ **端末解像度（240×240）** であることを検証する。
2. **ファイルサイズ目安（~15 KB 以下推奨）**:
   - 20 バイト単位で BLE 書き込み（1 チャンク約 250 回の GATT Write）を行うため、画像が大きすぎると転送時間が数倍になり不安定になりやすい。15 KB 前後に収めると実用速度・安定性ともに良好。
3. **タイムアウトタイマーの起算点**:
   - `enqueueWrite()` 完了**前**（書き込み開始時）に短いタイムアウトを張ると、20 バイト分割書き込み自体の完了前に誤タイムアウトが起きる。**BLE 書き込みキューの `await enqueueWrite(...)` が完了した後にタイマーを開始**する必要がある。
4. **95%（完了通知待ち）停止時・転送失敗コード仕様（APK `Lgh3.N` / `WatchThemeTransferManager.K` 確認済み）**:
   - 最終チャンク送信後、`0x1F/0x03` に対する完了応答 (`0x20/0x01 = 2`) が届かず 95% で停止する現象に対しては、**`0x20/0x01`（ステータス照会）＋ `0x1F/0x03` 再送（最大 2 回）** を行い、それでもタイムアウトする場合は最大 2 回まで全データの自動再送信（必要に応じ GATT 再接続）を行う。
   - 転送の開始条件として、BG02 実機は **バッテリー残量 20% 以上かつ非充電中** を要求する。主な `0x20/0x01` 応答コード（カッコ内は公式 APK 内部エラー番号）:
     - `1` (`1003`): 検証エラー / チェックサム不一致 (`verification_error`)
     - `2`: 更新完了 (`upgrade_success`)
     - `3` (`1008`): バッテリー残量不足（20% 未満）(`battery_low`)
     - `4` (`1009`): 充電中のため拒否 (`charging_status` / USB 充電ケーブルを抜いて実行)
     - `5` (`1010`): 空き容量不足 (`space_insufficient`)
     - `6` (`1011`): 文字盤保存数上限 (`theme_limit_exceeded`)
     - `7` (`1012`): 重複更新不可 (`duplicate_upgrade_local`)
     - `8` (`1013`): 文字盤 ID 不在 (`theme_id_not_found_local`)
     - `9` (`1015`): 更新頻度過多 (`upgrade_too_frequent_local`)
