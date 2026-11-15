# BG02 Studio

[日本語 README](./README.md)

A **100% local, zero-backend, TypeScript-based Progressive Web App (PWA)** for the **BG02 (E-BADGE)** Bluetooth electronic badge.  
Using the Web Bluetooth API in Chrome or Edge, you can align any image to the badge's circular 240×240 frame, optionally overlay text, generate a verified Baseline JPEG, and transfer it directly over BLE.

---

## Background & Motivation

1. **Broken Japanese UI / Missing Glyphs on Device Settings**  
   While the `BG02` hardware settings screen allows selecting Japanese, the built-in translations are awkward and certain characters disappear/corrupt due to incomplete glyph coverage. This originally motivated investigating font replacement or firmware modification.
2. **Privacy & Permission Concerns with the Official Android App**  
   Inspecting the official companion package (`com.legend.smartwatch.electronicbadge.android`) revealed excessive permissions and embedded SDKs (precise location / Baidu Location SDK, contacts, phone state, notification listener, audio recording, camera, internet access) unnecessary for simply pushing badge images.
3. **Why Safe Web / PWA Image Composition Instead of Firmware Modding**  
   - The device firmware relies on cryptographic signing (ECC-256 OTA verification) with no public firmware image or hardware brick recovery interface, making firmware modification unsafe.
   - However, protocol analysis showed that custom display faces (`WatchTheme3`) do not use the device's internal font ROM; instead, the device renders a **240×240 Baseline JPEG** pushed from the app.
   - Existing open-source tooling such as `openfantasymap/badger` targets the legacy `baji` (`PRODUCT_ID = 0x25`) protocol and is incompatible with `BG02` (`LJ733` / `mywatchsdklib`). Therefore, this project implements the `mywatchsdklib` WatchTheme3 JPEG protocol natively in TypeScript with zero runtime dependencies.

See [docs/BACKGROUND.md](./docs/BACKGROUND.md) and [docs/PROTOCOL.md](./docs/PROTOCOL.md) (Japanese) for full technical notes.

---

## Capabilities (What It Can Do)

- **100% Local & Zero External Network Requests**
  - Runs purely in the browser (installable as an offline PWA via a lightweight dependency-free Service Worker). Never sends telemetry or images to external servers.
- **Direct BLE Connection, Multi-Badge List, Auto-Reconnect & Unpairing Guide**
  - Reads Battery Level (auto-refreshed every 30 s while idle & connected), Device Information Service (DIS), display specs (`240×240`, `round`, `JPEG (4)`), and free flash storage (`0x20/0x04`).
  - **Multi-badge Home list**: Displays saved badges with clean status & battery readouts; tapping a badge connects (if disconnected) and transitions directly to the Single Image Push view, while a dedicated Device Details screen exposes specs, nickname editing, and step-by-step browser (`device.forget()`) & OS Bluetooth unpairing guides.
  - **Reconnect & Auto-Resend**: Supports exponential-backoff drop recovery (up to 3 retries), automatic connection checks before upload, 2-tier automatic resend for 95% completion stalls, and optional startup reconnect via `navigator.bluetooth.getDevices()`.
  - Handles the mandatory two-notify subscription (`7e400003` & `7e400004`), `0x12/0x0A` handshake, 20-byte GATT write chunking, and automatic `0xDC` ACK responses.
- **Beginner-Friendly Drill-Down Flow & Responsive PC Dual-Pane Studio**
  - Separates Home (`My Badges`), `Single image push`, and `Device Details & Unpair` into focused screens with explicit `<` Back navigation and browser history support.
  - On mobile viewports, `Single image push` keeps the UI ultra-clean (circular preview, Upload CTA, remaining space, Camera/Gallery tiles, collapsed advanced rows). On wide PC viewports (`>= 860px`), fine alignment, text overlay, quality controls, SOF0 inspection, and JPEG download appear expanded side-by-side.
  - Load local images (PNG / JPG / WebP / SVG) or capture via mobile camera, drag to pan, **2-finger pinch or scroll wheel to zoom**, rotate, and configure background fill inside the circular frame.
  - Optionally overlay multi-line stroked text (using system/browser fonts to avoid device mojibake), export/download locally or upload a verified **Baseline JPEG (`SOF0`)** with **auto-optimization targeting ≤ 15 KiB** (or switch to a manual quality slider).
- **Multilingual UI (i18n)**
  - Supports **Japanese (`ja`)** and **English (`en`)** out of the box with a type-safe dictionary schema for easy language additions.

---

## Limitations (What It Cannot Do)

Due to Web Bluetooth API and device firmware constraints, the following are not supported:

1. **No Firmware Modification or Built-in Settings Font Replacement**
   - Cannot fix mojibake inside the badge's own hardware settings menus. Custom Japanese text is rendered cleanly inside generated JPEG display images instead.
2. **Cannot Delete Factory Preset Images**
   - The `mywatchsdklib` protocol used by `BG02` exposes no image-delete command. Custom transfers overwrite fixed slot `watchID = 5538`.
3. **No Phone Call / App Notification Forwarding**
   - Browsers/PWAs cannot access Android's `NotificationListenerService`.
4. **No Background Daemon & No iOS Safari Support**
   - Web Bluetooth requires **Chrome or Edge on Desktop or Android** over HTTPS (or `http://localhost`). **iOS Safari is not supported.** BLE disconnects when the browser tab/app is closed.
5. **No Cloud Features (Simultaneous Translation / Official OTA)**
   - Excluded intentionally to stay 100% offline and independent of vendor cloud APIs.
6. **Unverified Optional Commands Excluded in Phase 1**
   - Commands defined in the companion APK whose `BG02` firmware support is not yet verified on real hardware (video MJPEG-AVI `fileType = 1`, `0x20/0x03` watch list, time sync, find device) are omitted from Phase 1.

---

## Development, Testing & GitHub Pages Deployment

```bash
npm install
npm run dev       # Local Vite dev server
npm run typecheck # Run TypeScript type check
npm test          # Run Vitest unit tests
npm run build     # Type-check + production build (dist/) + generate dist/sw.js
npm run docs      # Validate & generate TypeDoc API reference
```

- Configured with relative paths (`base: './'`) so `dist/` works both locally and under GitHub Pages subpaths (`https://<user>.github.io/<repo>/`), with an automated workflow in `.github/workflows/deploy.yml` and strict self-only CSP injected into production builds.

---

## Code Documentation Policy

- Zero external runtime dependencies (`dependencies` is empty).
- Every class, interface, type, function, variable, and constant includes **TypeDoc (`/** ... */`)** documentation, alongside explicit **intent comments** explaining non-obvious hardware/protocol constraints.

---

## Disclaimer & License

- Unofficial community tool created from protocol analysis and hardware testing; not affiliated with the device manufacturer. No vendor binaries or APK assets are included.
- Use at your own risk. Licensed under the [MIT License](./LICENSE).
