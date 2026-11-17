/**
 * @module __tests__/appFlow5Screens.test
 * Integration tests covering the 5-screen store flow, non-leaking badge status resolution,
 * draft preservation across badge management, history drift reconciliation, and i18n parity.
 */

import { describe, expect, it } from "vitest";
import type { ClockDialInfo, ConnectedDeviceMetadata } from "../ble/types";
import { DIAL_ERROR_KEY_MAP } from "../constants/ble";
import { enDictionary } from "../i18n/en";
import { interpolate } from "../i18n/i18n";
import { jaDictionary } from "../i18n/ja";
import { createDefaultTextOverlay } from "../imaging/badgeCompositor";
import { inspectJpeg } from "../imaging/jpegInspector";
import type { CompositedBadgeResult } from "../imaging/types";
import { AppStore } from "../state/appStore";
import { upsertDeviceProfile } from "../state/deviceRegistry";
import {
  evaluateUploadGate,
  reconcilePopStateSendTarget,
  resolveSendTargetView,
} from "../state/sendSession";
import { resolveBadgeStatusSummary } from "../ui/badgeStatusHelper";
import { applyScreenVisibility, resolvePopStateRoute, shouldPushHistoryEntry } from "../ui/screenRouter";

function makeValidBaselineJpegBytes(seedByte = 0x44): Uint8Array {
  const header = [
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00,
    0xf0, 0x00, 0xf0, 0x01,
  ];
  const filler = new Array<number>(280).fill(seedByte);
  return new Uint8Array([...header, ...filler, 0xff, 0xd9]);
}

function makeOutput(draftGeneration: number, seedByte = 0x44): CompositedBadgeResult {
  const jpegBytes = makeValidBaselineJpegBytes(seedByte);
  return {
    jpegBytes,
    byteLength: jpegBytes.length,
    usedQuality: 0.88,
    exceedsTarget: false,
    inspection: inspectJpeg(jpegBytes),
    exportCanvas: {} as HTMLCanvasElement,
    draftGeneration,
  };
}

function makeDialInfo(overrides: Partial<ClockDialInfo> = {}): ClockDialInfo {
  return {
    screenType: 1,
    shape: "round",
    grade: 0,
    width: 240,
    height: 240,
    mchModel: "K66",
    mainModel: "LJ733",
    config: 8,
    algorithm: 4,
    algorithmName: "JPEG (4)",
    versionCode: 0,
    customer: "JQ001",
    pictureNums: 1,
    watchThemeVersion: 9,
    watchThemeShortPkgLength: 5000,
    thumbWidth: 120,
    thumbHeight: 120,
    ...overrides,
  };
}

function makeMetadata(deviceId: string, deviceName: string, batteryPercent = 82): ConnectedDeviceMetadata {
  return {
    deviceId,
    deviceName,
    writeCapabilities: { write: true, writeWithoutResponse: true },
    notifyCount: 2,
    dialInfo: makeDialInfo(),
    freeStorageBytes: 60_000,
    freeStorageError: null,
    standardInfo: {
      batteryPercent,
      firmwareRevision: "V35922",
      hardwareRevision: "HW1.0",
    },
  };
}

describe("BG02 Studio 5-screen architecture & multi-badge safety", () => {
  it("keeps empty draft unpublishable initially and preserves edits when checking My Badges", () => {
    const store = new AppStore();
    expect(store.snapshot.activeScreen).toBe("home");
    expect(store.snapshot.selectedSendTargetId).toBeNull();
    expect(store.snapshot.draftGeneration).toBe(0);

    // User creates text-only draft in Screen 2 ("editor")
    store.patchState({ activeScreen: "editor" });
    store.updateTextOverlay({ enabled: true, text: "KATSU" });
    store.updateTransform({ scale: 1.4, offsetX: 12 });

    const editedGen = store.snapshot.draftGeneration;
    expect(editedGen).toBeGreaterThan(0);

    // Move to Screen 3 -> Screen 4 -> Screen 5 -> back to Screen 4 -> return to Send -> Editor
    store.patchState({
      activeScreen: "send",
      badgesReturnScreen: "send",
      selectedSendTargetId: "badge-1",
    });
    store.patchState({ activeScreen: "badges" });
    store.patchState({ activeScreen: "device-detail", detailDeviceId: "badge-1" });

    // Editing draft MUST stay completely intact across badge navigation
    const snap = store.snapshot;
    expect(snap.textOverlay.enabled).toBe(true);
    expect(snap.textOverlay.text).toBe("KATSU");
    expect(snap.transform.scale).toBe(1.4);
    expect(snap.transform.offsetX).toBe(12);
    expect(snap.draftGeneration).toBe(editedGen);
    expect(snap.badgesReturnScreen).toBe("send");
  });

  it("distinguishes live battery vs cached last-fetched vs unconfirmed telemetry without cross-device leakage", () => {
    const store = new AppStore();
    let profiles = upsertDeviceProfile([], {
      id: "badge-1",
      advertisedName: "BG02",
      batteryPercent: 78,
      connectedAtMs: 1000,
    });
    profiles = upsertDeviceProfile(profiles, {
      id: "badge-2",
      advertisedName: "BG02",
      batteryPercent: 45,
      connectedAtMs: 2000,
    });
    profiles = upsertDeviceProfile(profiles, {
      id: "badge-3",
      advertisedName: "BG02",
    });

    // badge-1 is live connected (88% live); badge-2 is disconnected with cached 45%; badge-3 has never been queried
    store.patchState({
      savedDevices: profiles,
      connectionStatus: "connected",
      activeDeviceId: "badge-1",
      metadata: makeMetadata("badge-1", "BG02", 88),
    });

    const snap = store.snapshot;
    const s1 = resolveBadgeStatusSummary(profiles[0], snap, jaDictionary);
    const s2 = resolveBadgeStatusSummary(profiles[1], snap, jaDictionary);
    const s3 = resolveBadgeStatusSummary(profiles[2], snap, jaDictionary);

    expect(s1.isConnectedHere).toBe(true);
    expect(s1.statusLabel).toBe(jaDictionary.badges.statusConnected);
    expect(s1.batteryText).toBe(interpolate(jaDictionary.badges.batteryPercent, { percent: 88 }));

    expect(s2.isConnectedHere).toBe(false);
    expect(s2.statusLabel).toBe(jaDictionary.badges.statusDisconnected);
    expect(s2.batteryText).toContain(jaDictionary.badges.prefixLastFetched);
    expect(s2.batteryText).toContain("45");

    expect(s3.isConnectedHere).toBe(false);
    expect(s3.batteryText).toBe(jaDictionary.badges.batteryUnconfirmed);

    // Send target view when user picks badge-2 while badge-1 is connected MUST NOT leak badge-1 telemetry
    const targetView2 = resolveSendTargetView({
      selectedSendTargetId: "badge-2",
      savedDevices: profiles,
      clientConnected: true,
      clientActiveId: "badge-1",
      connectedMetadata: snap.metadata,
    });
    expect(targetView2.targetDisplayName).toBe("BG02 #2");
    expect(targetView2.isTargetConnected).toBe(false);
    expect(targetView2.isDifferentDeviceConnected).toBe(true);
    expect(targetView2.liveMetadata).toBeNull();

    const blockedGate = evaluateUploadGate({
      hasSourceImage: false,
      textOverlay: { ...createDefaultTextOverlay(), enabled: true, text: "Hi" },
      targetView: targetView2,
      latestOutput: makeOutput(1),
      draftGeneration: 1,
    });
    expect(blockedGate).toEqual({ allowed: false, reason: "target_not_connected" });
  });

  it("detects history popstate target drift and invalidates frozen retry when draft changes", () => {
    const store = new AppStore();
    let profiles = upsertDeviceProfile([], { id: "badge-a", advertisedName: "BG02-A" });
    profiles = upsertDeviceProfile(profiles, { id: "badge-b", advertisedName: "BG02-B" });
    const metaA = makeMetadata("badge-a", "BG02-A", 92);

    const viewA = resolveSendTargetView({
      selectedSendTargetId: "badge-a",
      savedDevices: profiles,
      clientConnected: true,
      clientActiveId: "badge-a",
      connectedMetadata: metaA,
    });
    const gate = evaluateUploadGate({
      hasSourceImage: true,
      textOverlay: createDefaultTextOverlay(),
      targetView: viewA,
      latestOutput: makeOutput(2, 0x77),
      draftGeneration: 2,
    });
    expect(gate.allowed).toBe(true);
    if (gate.allowed) {
      store.patchState({ frozenRetrySession: gate.frozenSession });
      expect(store.snapshot.frozenRetrySession?.targetDeviceId).toBe("badge-a");
    }

    // Mutating transform invalidates stale retry snapshot so new edits cannot silently send old bytes
    store.updateTransform({ rotationDeg: 90 });
    expect(store.snapshot.frozenRetrySession).toBeNull();

    // PopState drift: user visited Send expecting badge-b while badge-a is active
    const drift = reconcilePopStateSendTarget({
      routeContextDeviceId: "badge-b",
      currentSelectedTargetId: "badge-b",
      clientConnected: true,
      clientActiveId: "badge-a",
    });
    expect(drift).toEqual({
      nextSelectedTargetId: null,
      targetDriftDetected: true,
    });
  });

  it("synchronizes 5-screen visibility, inert isolation, and history navigation state", () => {
    const createStubPanel = () => {
      const attrs = new Map<string, string>();
      return {
        hidden: true,
        inert: true,
        setAttribute: (k: string, v: string) => {
          attrs.set(k, v);
        },
        removeAttribute: (k: string) => {
          attrs.delete(k);
        },
        getAttribute: (k: string) => attrs.get(k) ?? null,
      } as unknown as HTMLElement;
    };

    const panels = {
      home: createStubPanel(),
      editor: createStubPanel(),
      send: createStubPanel(),
      badges: createStubPanel(),
      "device-detail": createStubPanel(),
    };

    applyScreenVisibility(panels, "device-detail", "forward");
    expect(panels["device-detail"].hidden).toBe(false);
    expect(panels["device-detail"].inert).toBe(false);
    expect(panels["device-detail"].getAttribute("aria-hidden")).toBe("false");
    expect(panels["device-detail"].getAttribute("data-nav-direction")).toBe("forward");

    expect(panels.home.hidden).toBe(true);
    expect(panels.home.inert).toBe(true);
    expect(panels.home.getAttribute("aria-hidden")).toBe("true");
    expect(panels.send.inert).toBe(true);

    expect(
      resolvePopStateRoute({
        screen: "device-detail",
        detailDeviceId: "badge-2",
        sendContextDeviceId: "badge-1",
        badgesReturnScreen: "send",
      })
    ).toEqual({
      screen: "device-detail",
      detailDeviceId: "badge-2",
      sendContextDeviceId: null,
      badgesReturnScreen: "send",
    });

    expect(shouldPushHistoryEntry("home", "editor", false)).toBe(true);
    expect(shouldPushHistoryEntry("editor", "editor", false)).toBe(false);
    expect(shouldPushHistoryEntry("home", "editor", true)).toBe(false);
  });

  it("keeps complete recursive JA/EN i18n key parity and DialError descriptions", () => {
    const checkParity = (jaObj: Record<string, unknown>, enObj: Record<string, unknown>, path: string) => {
      const jaKeys = Object.keys(jaObj).sort();
      const enKeys = Object.keys(enObj).sort();
      expect(enKeys, `Key mismatch at ${path}`).toEqual(jaKeys);
      for (const k of jaKeys) {
        const jv = jaObj[k];
        const ev = enObj[k];
        if (typeof jv === "string" || typeof ev === "string") {
          expect(typeof jv, `${path}.${k} JA should be string`).toBe("string");
          expect(typeof ev, `${path}.${k} EN should be string`).toBe("string");
          expect((jv as string).trim().length, `${path}.${k} JA non-empty`).toBeGreaterThan(0);
          expect((ev as string).trim().length, `${path}.${k} EN non-empty`).toBeGreaterThan(0);
        } else if (jv && ev && typeof jv === "object" && typeof ev === "object") {
          checkParity(jv as Record<string, unknown>, ev as Record<string, unknown>, `${path}.${k}`);
        }
      }
    };

    checkParity(
      jaDictionary as unknown as Record<string, unknown>,
      enDictionary as unknown as Record<string, unknown>,
      "root"
    );

    for (const errKey of Object.values(DIAL_ERROR_KEY_MAP)) {
      expect(jaDictionary.footer.dialErrors[errKey]).toBeTruthy();
      expect(enDictionary.footer.dialErrors[errKey]).toBeTruthy();
    }
  });
});
