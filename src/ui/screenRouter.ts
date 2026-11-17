/**
 * @module ui/screenRouter
 * Screen navigation helpers for the 5-screen BG02 workflow (`home` -> `editor` ->
 * `send` -> `badges` -> `device-detail`), synchronizing browser History entries,
 * `inert` / `aria-hidden` isolation, and keyboard focus restoration.
 */

import type { AppScreenId } from "../state/appStore";

/** Serializable state payload stored in browser History entries (`history.state`). */
export interface ScreenRouteState {
  /** Top-level visible screen identifier. */
  readonly screen: AppScreenId;
  /** Focused saved badge identifier when `screen === "device-detail"`. */
  readonly detailDeviceId: string | null;
  /** Destination badge identifier pinned when entering `"send"` so `popstate` detects drift. */
  readonly sendContextDeviceId?: string | null;
  /** Return destination when navigating back out of `"badges"`. */
  readonly badgesReturnScreen?: "home" | "send";
}

const VALID_SCREEN_IDS: ReadonlySet<AppScreenId> = new Set<AppScreenId>([
  "home",
  "editor",
  "send",
  "badges",
  "device-detail",
]);

/**
 * Validates and normalizes an untrusted `history.state` object from `popstate` events.
 *
 * @param raw - Unknown `PopStateEvent.state` payload.
 * @returns Sanitized {@link ScreenRouteState} defaulting safely to `"home"`.
 */
export function resolvePopStateRoute(raw: unknown): ScreenRouteState {
  if (!raw || typeof raw !== "object") {
    return {
      screen: "home",
      detailDeviceId: null,
      sendContextDeviceId: null,
      badgesReturnScreen: "home",
    };
  }
  const candidate = raw as Record<string, unknown>;
  const rawScreen = candidate.screen;
  const screen: AppScreenId =
    typeof rawScreen === "string" && VALID_SCREEN_IDS.has(rawScreen as AppScreenId)
      ? (rawScreen as AppScreenId)
      : "home";
  const detailDeviceId =
    typeof candidate.detailDeviceId === "string" && candidate.detailDeviceId.length > 0
      ? candidate.detailDeviceId
      : null;
  const sendContextDeviceId =
    typeof candidate.sendContextDeviceId === "string" &&
    candidate.sendContextDeviceId.length > 0
      ? candidate.sendContextDeviceId
      : null;
  const badgesReturnScreen: "home" | "send" =
    candidate.badgesReturnScreen === "send" ? "send" : "home";

  return {
    screen,
    detailDeviceId: screen === "device-detail" ? detailDeviceId : null,
    sendContextDeviceId: screen === "send" ? sendContextDeviceId : null,
    badgesReturnScreen,
  };
}

/**
 * Determines whether transitioning from `fromScreen` to `toScreen` should push a browser History entry.
 *
 * @param fromScreen - Current active screen ID.
 * @param toScreen - Destination screen ID.
 * @param viaPopState - `true` when already responding to browser Back/Forward navigation.
 * @returns `true` whenever a manual transition crosses between two distinct screens.
 */
export function shouldPushHistoryEntry(
  fromScreen: AppScreenId,
  toScreen: AppScreenId,
  viaPopState: boolean
): boolean {
  if (viaPopState) {
    return false;
  }
  return fromScreen !== toScreen;
}

/**
 * Applies accessible screen visibility, `inert` isolation, and directional transition flags
 * across all top-level screen elements.
 *
 * @param panels - Mapping from each {@link AppScreenId} to its root container element.
 * @param activeScreen - Screen currently visible to the user.
 * @param direction - Directional hint (`"forward"` | `"back"`) for optional reduced-motion-safe CSS.
 */
export function applyScreenVisibility(
  panels: Readonly<Record<AppScreenId, HTMLElement>>,
  activeScreen: AppScreenId,
  direction: "forward" | "back" = "forward"
): void {
  const entries = Object.entries(panels) as Array<[AppScreenId, HTMLElement]>;
  for (const [screenId, panel] of entries) {
    const isActive = screenId === activeScreen;
    panel.hidden = !isActive;
    panel.inert = !isActive;
    panel.setAttribute("aria-hidden", isActive ? "false" : "true");
    if (isActive) {
      panel.setAttribute("data-active", "true");
      panel.setAttribute("data-nav-direction", direction);
    } else {
      panel.removeAttribute("data-active");
      panel.removeAttribute("data-nav-direction");
    }
  }
}

/**
 * Moves keyboard focus to a prominent control inside the newly revealed screen
 * without scrolling the viewport unexpectedly.
 *
 * @param target - Primary heading, Back button, or trigger element on the revealed screen.
 */
export function focusAfterNavigation(target: HTMLElement | null): void {
  if (target && target.isConnected) {
    target.focus({ preventScroll: true });
  }
}
