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

- **100% Local Processing with Zero External Uploads**
  - All image cropping, Baseline JPEG generation, and BLE packets stay strictly inside your browser—never uploaded to external APIs or servers. Includes a scope-isolated Service Worker for offline PWA launches.
- **Focused 5-Screen Workflow (Single-Column Mobile + 60/40 Desktop Editor)**
  1. **Home**: A short logo screen leads to a first-visit guide. Start with **Connect badge**. Once connected, **Choose photo** becomes the primary action. **Try without connecting** opens the photo tools, including a bundled sample.
  2. **Adjust photo**: Drag, two-finger pinch, scroll wheel zoom, rotate, keyboard arrow/`+`/`-` adjustments, and baked-in stroked text overlays. Fine sliders and SOF0 validation stay neatly tucked inside collapsed `<details>` disclosures.
  3. **Send to badge**: Explicit target confirmation (with fixed `slot=5538` overwrite notice), native determinate/indeterminate `<progress>`, immutable single-image retries on disconnect/timeout, and clear refusal messages (`battery < 20%`, charging `code=4`, insufficient space, unsupported `algorithm`).
  4. **Registered badges**: The header opens the list of saved badges, including connection status and whether the battery reading is live, cached, or unavailable. **Manage** opens settings for the displayed badge.
  5. **Badge details**: Rename badge, configure auto-reconnect toggles, unregister with explicit badge-name confirmation and honest browser/OS unpairing instructions (`device.forget()`), plus collapsed BLE diagnostics and logs.
- **Works Offline Without Bluetooth for Editing & JPEG Export**
  - Even on iOS Safari or when no badge is connected, users can still compose circular artwork, add Japanese/English text, and save a verified `240×240` Baseline JPEG locally.

---

## OS & API Compatibility Matrix

| Platform / Browser | Web Bluetooth Upload | `getDevices()` / `forget()` | Local Editor & JPEG Save |
| :--- | :--- | :--- | :--- |
| Windows / macOS / Linux (Chrome / Edge) | Supported (HTTPS / localhost) | Build/flag dependent (chooser & manual unpair fallback included) | Supported |
| Android (Chrome / Edge) | Supported (BT & nearby permission required) | Chrome-version dependent | Supported |
| iOS / iPadOS Safari | **Not supported** | Not supported | **Supported** |

- **Hardware baseline**: Measured and verified on physical `BG02` hardware (`Manufacturer: LJ733_V1_BadgeOK`, `Hardware: LJ733_MB_V1.5`, `Firmware: V35922`, `240×240` Round, `algorithm = 4`). Post-redesign image transfers have been verified on real `BG02` hardware alongside multi-badge simulated BLE tests.

---

## Limitations (What It Cannot Do)

Due to Web Bluetooth API and device firmware constraints, the following are not supported:

1. **No Firmware Modification or Built-in Settings Font Replacement**
   - Cannot fix mojibake inside the badge's own hardware settings menus. Custom Japanese text is rendered cleanly inside generated JPEG display images instead.
2. **No Remote Image Deletion Over BLE (Delete Presets on Device Instead)**
   - The `mywatchsdklib` BLE protocol exposes no remote image-delete command, and custom transfers overwrite fixed slot `watchID = 5538`.
   - However, **initial factory preset images can be deleted directly on the BG02 device itself** if you want to free flash storage.
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
