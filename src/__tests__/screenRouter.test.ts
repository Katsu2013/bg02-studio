import { describe, expect, it, vi } from "vitest";
import {
  applyScreenVisibility,
  focusAfterNavigation,
  resolvePopStateRoute,
  shouldPushHistoryEntry,
} from "../ui/screenRouter";

describe("screenRouter", () => {
  it("validates popstate history entries cleanly and falls back to home on unknown input", () => {
    expect(resolvePopStateRoute(null)).toEqual({ screen: "home", detailDeviceId: null });
    expect(resolvePopStateRoute("invalid")).toEqual({ screen: "home", detailDeviceId: null });
    expect(resolvePopStateRoute({ screen: "unknown", detailDeviceId: "abc" })).toEqual({
      screen: "home",
      detailDeviceId: "abc",
    });
    expect(resolvePopStateRoute({ screen: "push", detailDeviceId: "badge-1" })).toEqual({
      screen: "push",
      detailDeviceId: "badge-1",
    });
    expect(resolvePopStateRoute({ screen: "device-detail", detailDeviceId: 123 })).toEqual({
      screen: "device-detail",
      detailDeviceId: null,
    });
  });

  it("pushes browser history entries only on manual forward drill-downs from home", () => {
    expect(shouldPushHistoryEntry("home", "push", false)).toBe(true);
    expect(shouldPushHistoryEntry("home", "device-detail", false)).toBe(true);
    expect(shouldPushHistoryEntry("home", "home", false)).toBe(false);
    expect(shouldPushHistoryEntry("push", "home", false)).toBe(false);
    expect(shouldPushHistoryEntry("home", "push", true)).toBe(false);
  });

  it("applies hidden, inert, aria-hidden, and directional animation flags to screen panels", () => {
    function makeMockPanel(): HTMLElement {
      const attrs = new Map<string, string>();
      return {
        hidden: false,
        inert: false,
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        getAttribute: (k: string) => attrs.get(k) ?? null,
        removeAttribute: (k: string) => attrs.delete(k),
      } as unknown as HTMLElement;
    }

    const panels = {
      home: makeMockPanel(),
      push: makeMockPanel(),
      "device-detail": makeMockPanel(),
    };

    applyScreenVisibility(panels, "push", "forward");

    expect(panels.home.hidden).toBe(true);
    expect(panels.home.inert).toBe(true);
    expect(panels.home.getAttribute("aria-hidden")).toBe("true");
    expect(panels.home.getAttribute("data-active")).toBe("false");

    expect(panels.push.hidden).toBe(false);
    expect(panels.push.inert).toBe(false);
    expect(panels.push.getAttribute("aria-hidden")).toBe("false");
    expect(panels.push.getAttribute("data-active")).toBe("true");
    expect(panels.push.getAttribute("data-nav-dir")).toBe("forward");

    expect(panels["device-detail"].hidden).toBe(true);
    expect(panels["device-detail"].inert).toBe(true);

    applyScreenVisibility(panels, "home", "back");
    expect(panels.push.getAttribute("data-nav-dir")).toBeNull();
    expect(panels.home.getAttribute("data-nav-dir")).toBe("back");
    expect(panels.home.inert).toBe(false);
  });

  it("focuses navigation target with preventScroll when connected", () => {
    const focusSpy = vi.fn();
    const disconnectedFocusSpy = vi.fn();

    focusAfterNavigation({ isConnected: true, focus: focusSpy } as unknown as HTMLElement);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });

    focusAfterNavigation({
      isConnected: false,
      focus: disconnectedFocusSpy,
    } as unknown as HTMLElement);
    expect(disconnectedFocusSpy).not.toHaveBeenCalled();
    focusAfterNavigation(null);
  });
});
