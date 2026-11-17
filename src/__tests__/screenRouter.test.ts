import { describe, expect, it, vi } from "vitest";
import {
  applyScreenVisibility,
  focusAfterNavigation,
  resolvePopStateRoute,
  shouldPushHistoryEntry,
} from "../ui/screenRouter";

describe("screenRouter", () => {
  it("validates popstate history entries across all 5 screens and falls back to home", () => {
    expect(resolvePopStateRoute(null)).toEqual({
      screen: "home",
      detailDeviceId: null,
      sendContextDeviceId: null,
      badgesReturnScreen: "home",
    });
    expect(resolvePopStateRoute({ screen: "unknown-screen" })).toEqual({
      screen: "home",
      detailDeviceId: null,
      sendContextDeviceId: null,
      badgesReturnScreen: "home",
    });
    expect(resolvePopStateRoute({ screen: "editor" })).toEqual({
      screen: "editor",
      detailDeviceId: null,
      sendContextDeviceId: null,
      badgesReturnScreen: "home",
    });
    expect(
      resolvePopStateRoute({ screen: "send", sendContextDeviceId: "badge-a" })
    ).toEqual({
      screen: "send",
      detailDeviceId: null,
      sendContextDeviceId: "badge-a",
      badgesReturnScreen: "home",
    });
    expect(
      resolvePopStateRoute({ screen: "badges", badgesReturnScreen: "send" })
    ).toEqual({
      screen: "badges",
      detailDeviceId: null,
      sendContextDeviceId: null,
      badgesReturnScreen: "send",
    });
    expect(
      resolvePopStateRoute({ screen: "device-detail", detailDeviceId: "badge-b" })
    ).toEqual({
      screen: "device-detail",
      detailDeviceId: "badge-b",
      sendContextDeviceId: null,
      badgesReturnScreen: "home",
    });
  });

  it("pushes history entries on manual cross-screen transitions only", () => {
    expect(shouldPushHistoryEntry("home", "editor", false)).toBe(true);
    expect(shouldPushHistoryEntry("editor", "send", false)).toBe(true);
    expect(shouldPushHistoryEntry("send", "badges", false)).toBe(true);
    expect(shouldPushHistoryEntry("badges", "device-detail", false)).toBe(true);
    expect(shouldPushHistoryEntry("editor", "home", false)).toBe(true);
    expect(shouldPushHistoryEntry("editor", "editor", false)).toBe(false);
    expect(shouldPushHistoryEntry("home", "send", true)).toBe(false);
  });

  it("applies hidden, inert, aria-hidden, and directional animation flags to all 5 panels", () => {
    const createMockPanel = (): HTMLElement => {
      const attrs = new Map<string, string>();
      return {
        hidden: false,
        inert: false,
        setAttribute: (name: string, value: string) => {
          attrs.set(name, value);
        },
        getAttribute: (name: string) => attrs.get(name) ?? null,
        removeAttribute: (name: string) => {
          attrs.delete(name);
        },
      } as unknown as HTMLElement;
    };

    const home = createMockPanel();
    const editor = createMockPanel();
    const send = createMockPanel();
    const badges = createMockPanel();
    const detail = createMockPanel();

    applyScreenVisibility(
      { home, editor, send, badges, "device-detail": detail },
      "send",
      "forward"
    );

    expect(home.hidden).toBe(true);
    expect(home.inert).toBe(true);
    expect(home.getAttribute("aria-hidden")).toBe("true");
    expect(editor.hidden).toBe(true);
    expect(send.hidden).toBe(false);
    expect(send.inert).toBe(false);
    expect(send.getAttribute("aria-hidden")).toBe("false");
    expect(send.getAttribute("data-active")).toBe("true");
    expect(send.getAttribute("data-nav-direction")).toBe("forward");
    expect(badges.hidden).toBe(true);
    expect(detail.hidden).toBe(true);

    applyScreenVisibility(
      { home, editor, send, badges, "device-detail": detail },
      "home",
      "back"
    );

    expect(home.hidden).toBe(false);
    expect(home.getAttribute("data-nav-direction")).toBe("back");
    expect(send.hidden).toBe(true);
    expect(send.getAttribute("data-active")).toBeNull();
  });

  it("focuses navigation target with preventScroll when connected", () => {
    const focusConnected = vi.fn();
    const connectedBtn = {
      isConnected: true,
      focus: focusConnected,
    } as unknown as HTMLElement;
    focusAfterNavigation(connectedBtn);
    expect(focusConnected).toHaveBeenCalledWith({ preventScroll: true });

    const focusDisconnected = vi.fn();
    const disconnectedBtn = {
      isConnected: false,
      focus: focusDisconnected,
    } as unknown as HTMLElement;
    focusAfterNavigation(disconnectedBtn);
    expect(focusDisconnected).not.toHaveBeenCalled();
  });
});
