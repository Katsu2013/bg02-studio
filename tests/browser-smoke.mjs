// Run after npm run build with Playwright available in the environment.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const dist = path.join(root, "dist");
const screens = path.join(root, "docs", "screenshots");
const origin = "http://localhost:41821";
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json",
};
await mkdir(screens, { recursive: true });

function installFakeBluetooth() {
  const counters = { A: { gatt: 0, start: 0, finish: 0 }, B: { gatt: 0, start: 0, finish: 0 } };
  const failGATT = { A: 0, B: 0 };
  const battery = { A: 82, B: 80 };
  const devices = {};
  let picker = "A";
  let granted = [];
  let pickerOpens = 0;
  for (const id of ["A", "B"]) {
    const device = new EventTarget();
    const notify = new EventTarget();
    const quiet = new EventTarget();
    const startNotifications = async function () { return this; };
    const stopNotifications = async function () { return this; };
    Object.assign(notify, { uuid: "7e400003", startNotifications, stopNotifications });
    Object.assign(quiet, { uuid: "7e400004", startNotifications, stopNotifications });
    let frame = [];
    function respond(key, payload) {
      const raw = Uint8Array.of(0xcd, 0, payload.length + 5, 0x20, 1, key, 0, payload.length, ...payload);
      setTimeout(() => {
        if (!device.gatt.connected) return;
        notify.value = new DataView(raw.buffer);
        notify.dispatchEvent(new Event("characteristicvaluechanged"));
      }, 35);
    }
    function status(code) { respond(1, [(code >>> 24) & 255, (code >>> 16) & 255, (code >>> 8) & 255, code & 255]); }
    async function writeValue(input) {
      const bytes = [...(input instanceof ArrayBuffer
        ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength))];
      if (!frame.length && bytes[0] !== 0xcd) return;
      frame.push(...bytes);
      if (frame.length < 8 || frame.length < 3 + ((frame[1] << 8) | frame[2])) return;
      const [module, key] = [frame[3], frame[5]];
      if (module === 0x20 && key === 2) respond(2,
        [1,0,0,240,0,240,3,75,54,54,5,76,74,55,51,51,7,4,1,1,0,5,74,81,48,48,49,0,0,9,0x13,0x88]);
      if (module === 0x20 && key === 4) respond(4, [0,0,0,0,0,5,112,0]);
      if (module === 0x1f && key === 2) { counters[id].start++; status(1000); }
      if (module === 0x1f && key === 1) status(1000 + ((frame[8] << 8) | frame[9]));
      if (module === 0x1f && key === 3) { counters[id].finish++; status(2); }
      frame = [];
    }
    const write = { properties: { write: true, writeWithoutResponse: true }, writeValueWithResponse: writeValue };
    Object.assign(device, {
      id, name: "BG02",
      gatt: {
        connected: false,
        async connect() {
          counters[id].gatt++;
          if (failGATT[id] > 0) {
            failGATT[id]--;
            throw new DOMException("Simulated out of range", "NetworkError");
          }
          this.connected = true;
          return this;
        },
        disconnect() {
          if (!this.connected) return;
          this.connected = false;
          frame = [];
          device.dispatchEvent(new Event("gattserverdisconnected"));
        },
        async getPrimaryService(service) {
          return { async getCharacteristic(uuid) {
            if (uuid.startsWith("7e400002")) return write;
            if (uuid.startsWith("7e400003")) return notify;
            if (uuid.startsWith("7e400004")) return quiet;
            const value = service === 0x180f ? Uint8Array.of(battery[id]) : new TextEncoder().encode("V35922");
            return { readValue: async () => new DataView(value.buffer) };
          } };
        },
      },
      async forget() { granted = granted.filter((key) => key !== id); },
    });
    devices[id] = device;
  }
  // Browser reloads preserve the simulated permission list just as getDevices() would.
  granted = JSON.parse(sessionStorage.getItem("mock-permissions") || "[]");
  Object.defineProperty(navigator, "bluetooth", { configurable: true, value: {
    async requestDevice() {
      pickerOpens++;
      if (!picker) throw new DOMException("Picker cancelled", "NotFoundError");
      if (!granted.includes(picker)) granted.push(picker);
      sessionStorage.setItem("mock-permissions", JSON.stringify(granted));
      return devices[picker];
    },
    async getDevices() { return granted.map((id) => devices[id]); },
  } });
  window.fakeBadge = {
    counters, failGATT, battery,
    pickerOpens: () => pickerOpens,
    setPicker: (id) => { picker = id; },
    drop: (id) => devices[id].gatt.disconnect(),
  };
}

let startupShown = false;
async function context(browser, options, initScript, holdStartup = false) {
  const ctx = await browser.newContext({ locale: "ja-JP", reducedMotion: "reduce", ...options, serviceWorkers: "block" });
  if (initScript) await ctx.addInitScript(initScript);
  await ctx.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (holdStartup && relative.startsWith("assets/") && relative.endsWith(".js")) {
      const [page] = ctx.pages();
      await page.locator("#startup").waitFor({ state: "visible" });
      startupShown = true;
    }
    const body = await readFile(path.join(dist, relative)).catch(() => null);
    return body
      ? route.fulfill({ body, contentType: types[path.extname(relative)] })
      : route.fulfill({ status: 404, body: "File not found" });
  });
  return ctx;
}

async function expectText(page, selector, pattern) {
  const locator = page.locator(selector).filter({ hasText: pattern });
  await locator.waitFor({ state: "visible" });
}

async function withinViewport(locator, viewport) {
  const box = await locator.boundingBox();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width &&
    box.y + box.height <= viewport.height, "Action should fit inside the initial viewport");
}

async function dismissGuide(page) {
  await page.getByRole("dialog").getByRole("button", { name: "OK" }).click();
  await page.locator("#first-run-guide").waitFor({ state: "hidden" });
}

async function expectGuideTarget(page, selector) {
  const button = await page.locator(selector).boundingBox();
  const spotlight = await page.locator(".guide-spotlight").boundingBox();
  const arrow = await page.locator(".guide-arrow").boundingBox();
  assert.ok(button && spotlight && arrow);
  assert.ok(spotlight.x < button.x && spotlight.x + spotlight.width > button.x + button.width);
  assert.ok(spotlight.y < button.y && spotlight.y + spotlight.height > button.y + button.height);
  assert.ok(Math.abs(arrow.x + arrow.width / 2 - button.x - button.width / 2) < 2);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_EXECUTABLE || undefined,
  args: ["--no-sandbox"],
});
try {
  const errors = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    const ctx = await context(browser, { viewport }, installFakeBluetooth, viewport.width === 1440);
    const page = await ctx.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page.locator("#startup").waitFor();
    assert.equal(await page.locator("#first-run-guide").isVisible(), false);
    if (viewport.width === 390) await page.screenshot({ path: path.join(screens, "splash-390.png") });
    await page.getByRole("dialog", { name: "最初にバッジを接続する" }).waitFor();
    const elapsed = await page.evaluate(() =>
      performance.now() - (performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0));
    assert.ok(elapsed >= 1900, "Splash remains visible for about two seconds");
    await page.locator(".home-photo-preview").first().evaluate((img) => img.decode());
    await expectGuideTarget(page, ".home-actions .btn-primary:visible");
    await withinViewport(page.locator(".guide-tip"), viewport);
    if (viewport.width === 390) await page.screenshot({ path: path.join(screens, "guide-390.png") });
    await dismissGuide(page);
    const connect = page.locator("#home").getByRole("button", { name: "バッジを接続", exact: true });
    await withinViewport(connect, viewport);
    assert.ok(await connect.evaluate((button) => button === document.activeElement));
    assert.equal(await page.locator("#home").getByRole("button", { name: "写真を選ぶ", exact: true }).count(), 0);
    if (viewport.width !== 320) await page.screenshot({ path: path.join(screens, `home-${viewport.width}.png`) });
    await page.getByRole("button", { name: "接続せずに試す" }).click();
    await withinViewport(page.locator("#home").getByRole("button", { name: "写真を選ぶ", exact: true }), viewport);
    await page.getByRole("button", { name: "サンプル写真で試す" }).click();
    const editor = page.locator(".editor-screen");
    const next = editor.getByRole("button", { name: "送信へ", exact: true });
    await next.waitFor();
    if (viewport.width !== 1440) await withinViewport(next, viewport);
    assert.equal(await page.evaluate(() => window.fakeBadge.pickerOpens()), 0);
    if (viewport.width === 390) await page.screenshot({ path: path.join(screens, "edit-390.png") });
    await next.click();
    await page.locator(".send-screen").waitFor();
    if (viewport.width === 390) await page.screenshot({ path: path.join(screens, "send-390.png") });
    await ctx.close();
  }
  assert.ok(startupShown, "The static splash appears before JavaScript is available");
  console.log("Responsive integration verified.");

  const ctx = await context(browser, { viewport: { width: 390, height: 844 }, acceptDownloads: true }, installFakeBluetooth);
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await dismissGuide(page);
  const home = page.locator("#home");
  const counters = () => page.evaluate(() => window.fakeBadge.counters);
  await page.evaluate(() => { window.fakeBadge.failGATT.A = 2; });
  await home.getByRole("button", { name: "バッジを接続", exact: true }).click();
  await expectText(page, "#home .home-description", /バッジと通信できませんでした/);
  await home.getByRole("button", { name: "再試行", exact: true }).click();
  await expectText(page, ".home-connection-copy p", /^接続済み$/);
  assert.equal(await page.evaluate(() => window.fakeBadge.pickerOpens()), 1);
  assert.equal((await counters()).A.start, 0);
  await page.screenshot({ path: path.join(screens, "home-connected-390.png") });

  const gatt = (await counters()).A.gatt;
  await page.evaluate(() => {
    window.fakeBadge.failGATT.A = 2;
    window.fakeBadge.drop("A");
  });
  await expectText(page, "#home .home-description", /再接続中/);
  await expectText(page, ".home-connection-copy p", /^接続済み$/);
  assert.equal((await counters()).A.gatt, gatt + 3, "The second recovery round is reached");
  assert.equal((await counters()).A.start, 0);
  await page.reload();
  await expectText(page, ".home-connection-copy p", /^接続済み$/);
  assert.equal(await page.locator("#first-run-guide").isVisible(), false);
  assert.equal(await page.evaluate(() => window.fakeBadge.pickerOpens()), 0);

  const header = page.locator(".app-header");
  await header.getByRole("button", { name: "登録済みバッジ" }).click();
  await page.evaluate(() => window.fakeBadge.setPicker("B"));
  await page.locator(".badges-screen").getByRole("button", { name: "バッジを追加" }).click();
  await page.locator(".badges-screen").getByRole("button", { name: "BG02 #2の管理" }).waitFor();
  await page.screenshot({ path: path.join(screens, "registered-badges-390.png") });
  await header.getByRole("button", { name: "BG02 Studio" }).click();
  await expectText(page, ".home-connection-copy h2", /^BG02 #2$/);
  await home.getByRole("button", { name: "BG02 #2の管理" }).click();
  await expectText(page, ".detail-badge-name", /^BG02 #2$/);
  await page.screenshot({ path: path.join(screens, "badge-manage-390.png") });
  await page.locator(".detail-screen").getByRole("textbox", { name: "バッジの名前" }).fill("イベント用");
  await page.getByRole("button", { name: "名前を保存" }).click();
  await expectText(page, ".detail-badge-name", /^イベント用$/);
  await page.goBack();
  await expectText(page, ".home-connection-copy h2", /^イベント用$/);
  await page.goForward();
  await expectText(page, ".detail-badge-name", /^イベント用$/);
  console.log("Connection, recovery and per-badge management verified.");

  await header.getByRole("button", { name: "BG02 Studio" }).click();
  await page.locator('input[type="file"]').setInputFiles(path.join(root, "public", "sample-fuji.jpg"));
  const editor = page.locator(".editor-screen");
  await editor.getByRole("button", { name: "回転", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await editor.getByRole("button", { name: "画像を保存", exact: true }).click();
  assert.equal((await downloadEvent).suggestedFilename(), "bg02-badge-240x240.jpg");
  await editor.getByRole("button", { name: "送信へ", exact: true }).click();
  const send = page.locator(".send-screen");
  const sendAction = send.getByRole("button", { name: "イベント用 へ送る", exact: true });
  await sendAction.waitFor();
  assert.deepEqual([(await counters()).A.start, (await counters()).B.start], [0, 0]);

  await page.evaluate(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      HTMLCanvasElement.prototype.toBlob = toBlob;
      window.releaseEncode = () => toBlob.apply(this, args);
    };
  });
  await sendAction.click();
  await send.getByText("画像を準備中…", { exact: true }).first().waitFor();
  await header.getByRole("button", { name: "登録済みバッジ" }).click();
  await page.locator(".badges-screen").getByRole("button", { name: "BG02 #1の管理" }).click();
  await page.locator(".detail-screen").getByRole("button", { name: "このバッジに接続", exact: true }).click();
  await page.locator(".detail-screen").getByRole("button", { name: "切断", exact: true }).waitFor();
  await page.evaluate(() => window.releaseEncode());
  assert.deepEqual([(await counters()).A.start, (await counters()).B.start], [0, 0], "Changing the badge while encoding sends no Start frame");

  await page.locator(".detail-screen").getByRole("button", { name: "このバッジに写真を送る" }).click();
  await editor.getByRole("button", { name: "送信へ", exact: true }).click();
  await send.getByRole("button", { name: "BG02 #1 へ送る", exact: true }).click();
  await send.getByText("BG02 #1 に送信しました", { exact: true }).waitFor();
  assert.deepEqual([(await counters()).A.start, (await counters()).A.finish, (await counters()).B.start], [1, 1, 0]);
  await ctx.close();

  const offline = await context(browser, { viewport: { width: 390, height: 844 } },
    () => { delete Navigator.prototype.bluetooth; });
  const nonBle = await offline.newPage();
  nonBle.on("pageerror", (error) => errors.push(error.message));
  await nonBle.goto(origin);
  await nonBle.getByRole("dialog", { name: "最初の写真を選ぶ" }).waitFor();
  await dismissGuide(nonBle);
  await expectText(nonBle, ".home-connection-copy p", /写真の編集と保存はできます/);
  await nonBle.getByRole("button", { name: "EN", exact: true }).click();
  await nonBle.getByRole("button", { name: "Registered badges", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("Browser integration passed: startup, guide, offline editing, reconnect, scoped management, download, and protected transfer.");
} finally {
  await browser.close();
}
