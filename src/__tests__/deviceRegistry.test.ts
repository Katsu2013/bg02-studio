import { describe, expect, it } from "vitest";
import {
  createDefaultReconnectPrefs,
  DEVICE_ACCENT_PALETTE,
  pickStartupReconnectTarget,
  removeDeviceProfile,
  renameDeviceProfile,
  resolveUploadReconnectPlan,
  upsertDeviceProfile,
} from "../state/deviceRegistry";

describe("deviceRegistry", () => {
  it("creates numbered nicknames and distinct accent colors when registering multiple BG02 badges", () => {
    let list = upsertDeviceProfile([], {
      id: "badge-a",
      advertisedName: "BG02",
      batteryPercent: 88,
      connectedAtMs: 1000,
    });
    list = upsertDeviceProfile(list, {
      id: "badge-b",
      advertisedName: "BG02",
      batteryPercent: 42,
      connectedAtMs: 2000,
    });

    expect(list).toHaveLength(2);
    expect(list[0].nickname).toBe("BG02 #1");
    expect(list[0].accentHex).toBe(DEVICE_ACCENT_PALETTE[0]);
    expect(list[0].lastBatteryPercent).toBe(88);
    expect(list[1].nickname).toBe("BG02 #2");
    expect(list[1].accentHex).toBe(DEVICE_ACCENT_PALETTE[1]);
    expect(list[1].lastBatteryPercent).toBe(42);
  });

  it("updates telemetry and preserves custom nicknames on subsequent connections", () => {
    const initial = upsertDeviceProfile([], {
      id: "badge-a",
      advertisedName: "BG02",
      batteryPercent: 75,
      connectedAtMs: 1000,
    });
    const renamed = renameDeviceProfile(initial, "badge-a", "Backpack Badge");
    expect(renamed[0].nickname).toBe("Backpack Badge");

    // Ignored blank nickname preserves existing label
    const unchanged = renameDeviceProfile(renamed, "badge-a", "   ");
    expect(unchanged[0].nickname).toBe("Backpack Badge");

    const updated = upsertDeviceProfile(unchanged, {
      id: "badge-a",
      advertisedName: "BG02",
      batteryPercent: 54,
      connectedAtMs: 5000,
    });
    expect(updated).toHaveLength(1);
    expect(updated[0].nickname).toBe("Backpack Badge");
    expect(updated[0].lastBatteryPercent).toBe(54);
    expect(updated[0].lastConnectedAtMs).toBe(5000);
  });

  it("removes forgotten badges cleanly without mutating original array", () => {
    let list = upsertDeviceProfile([], { id: "id-1", advertisedName: "BG02" });
    list = upsertDeviceProfile(list, { id: "id-2", advertisedName: "BG02" });

    const filtered = removeDeviceProfile(list, "id-1");
    expect(filtered.map((item) => item.id)).toEqual(["id-2"]);
    expect(list).toHaveLength(2);
  });

  it("picks startup reconnect target prioritizing lastActiveDeviceId when permitted and enabled", () => {
    let profiles = upsertDeviceProfile([], {
      id: "old-id",
      advertisedName: "BG02",
      connectedAtMs: 1000,
    });
    profiles = upsertDeviceProfile(profiles, {
      id: "recent-id",
      advertisedName: "BG02",
      connectedAtMs: 5000,
    });

    const prefs = {
      ...createDefaultReconnectPrefs(),
      lastActiveDeviceId: "old-id",
    };

    // Prefers lastActiveDeviceId when live in getDevices()
    expect(
      pickStartupReconnectTarget(profiles, new Set(["old-id", "recent-id"]), prefs)
    ).toBe("old-id");

    // Falls back to most recently connected permitted badge when lastActive is missing
    expect(
      pickStartupReconnectTarget(profiles, new Set(["recent-id"]), prefs)
    ).toBe("recent-id");

    // Falls back to first live permitted device even if profiles were cleared
    expect(pickStartupReconnectTarget([], new Set(["browser-only-id"]), prefs)).toBe(
      "browser-only-id"
    );

    // Disabled autoConnectOnStartup always returns null
    expect(
      pickStartupReconnectTarget(profiles, new Set(["old-id"]), {
        ...prefs,
        autoConnectOnStartup: false,
      })
    ).toBeNull();
  });

  it("resolves upload reconnect targets across active, client, recent live, and fresh picker states", () => {
    let profiles = upsertDeviceProfile([], {
      id: "old-id",
      advertisedName: "BG02",
      connectedAtMs: 1000,
    });
    profiles = upsertDeviceProfile(profiles, {
      id: "recent-id",
      advertisedName: "BG02",
      connectedAtMs: 5000,
    });
    const basePrefs = {
      ...createDefaultReconnectPrefs(),
      lastActiveDeviceId: null,
    };

    // 1. UI activeDeviceId wins
    expect(
      resolveUploadReconnectPlan({
        activeDeviceId: "active-id",
        clientActiveId: "client-id",
        canReconnect: true,
        savedDevices: profiles,
        liveDeviceIds: ["recent-id"],
        prefs: { ...basePrefs, lastActiveDeviceId: "pref-id" },
      })
    ).toEqual({ reuseDevice: true, targetDeviceId: "active-id" });

    // 2. Falls back to clientActiveId, then lastActiveDeviceId
    expect(
      resolveUploadReconnectPlan({
        activeDeviceId: null,
        clientActiveId: "client-id",
        canReconnect: true,
        savedDevices: profiles,
        liveDeviceIds: ["recent-id"],
        prefs: { ...basePrefs, lastActiveDeviceId: "pref-id" },
      })
    ).toEqual({ reuseDevice: true, targetDeviceId: "client-id" });

    expect(
      resolveUploadReconnectPlan({
        activeDeviceId: null,
        clientActiveId: null,
        canReconnect: false,
        savedDevices: profiles,
        liveDeviceIds: [],
        prefs: { ...basePrefs, lastActiveDeviceId: "pref-id" },
      })
    ).toEqual({ reuseDevice: true, targetDeviceId: "pref-id" });

    // 3. Prefers live recent saved profile over non-live saved profile
    expect(
      resolveUploadReconnectPlan({
        activeDeviceId: null,
        clientActiveId: null,
        canReconnect: false,
        savedDevices: profiles,
        liveDeviceIds: ["old-id"],
        prefs: basePrefs,
      })
    ).toEqual({ reuseDevice: true, targetDeviceId: "old-id" });

    // 4. Uses most recent saved profile even if getDevices() cache is cold (chooser fallback handled in connect)
    expect(
      resolveUploadReconnectPlan({
        activeDeviceId: null,
        clientActiveId: null,
        canReconnect: false,
        savedDevices: profiles,
        liveDeviceIds: [],
        prefs: basePrefs,
      })
    ).toEqual({ reuseDevice: true, targetDeviceId: "recent-id" });

    // 5. Opens picker immediately when no badge has ever been paired
    expect(
      resolveUploadReconnectPlan({
        activeDeviceId: null,
        clientActiveId: null,
        canReconnect: false,
        savedDevices: [],
        liveDeviceIds: [],
        prefs: basePrefs,
      })
    ).toEqual({ reuseDevice: false, targetDeviceId: undefined });
  });
});
