/**
 * @module ui/screenRouter
 * Drill-down screen navigation utilities syncing view state, `inert` isolation,
 * browser `history.pushState`/`popstate` navigation, and non-scrolling focus restoration.
 */

import type { AppScreenId } from "../state/appStore";

/** Normalized screen navigation payload persisted inside browser History entries. */
export interface ScreenRouteState {
  /** Active top-level screen (`"home" | "push" | "device-detail"`). */
  readonly screen: AppScreenId;
  /** Optional focused badge identifier for `"device-detail"`, or `null`. */
  readonly detailDeviceId: string | null;
}

/** Valid screen identifiers accepted from browser history entries. */
const VALID_SCREEN_IDS: ReadonlySet<AppScreenId> = new Set<AppScreenId>([
  "home",
  "push",
  "device-detail",
]);

/**
 * Type guard validating unknown `history.state` objects safely against {@link ScreenRouteState}.
 *
 * @param raw - Unknown browser history state object from `popstate`.
 * @returns Normalized {@link ScreenRouteState}, defaulting cleanly to Home when malformed.
 */
export function resolvePopStateRoute(raw: unknown): ScreenRouteState {
  if (!raw || typeof raw !== "object") {
    return { screen: "home", detailDeviceId: null };
  }
  const obj = raw as Record<string, unknown>;
  const rawScreen = obj.screen;
  const screen: AppScreenId =
    typeof rawScreen === "string" && VALID_SCREEN_IDS.has(rawScreen as AppScreenId)
      ? (rawScreen as AppScreenId)
      : "home";
  const detailDeviceId = typeof obj.detailDeviceId === "string" ? obj.detailDeviceId : null;
  return { screen, detailDeviceId };
}

/**
 * Determines whether navigating between two screens should append a browser history entry
 * so hardware/OS Back buttons and swipe-back gestures return cleanly to the Home screen.
 *
 * @param fromScreen - Current active screen before transition.
 * @param toScreen - Target screen after transition.
 * @param viaPopState - `true` when triggered by an external browser `popstate` event.
 * @returns `true` if `history.pushState()` should record the drill-down step.
 */
export function shouldPushHistoryEntry(
  fromScreen: AppScreenId,
  toScreen: AppScreenId,
  viaPopState: boolean
): boolean {
  if (viaPopState) {
    return false;
  }
  return fromScreen === "home" && toScreen !== "home";
}

/**
 * Isolates inactive drill-down screens cleanly by toggling both `hidden` and `inert`
 * so keyboard navigation and screen readers never leak into non-visible screens.
 *
 * // 意図: stack-drill-down ガイドラインに従い、表示中の画面以外に `inert` と `aria-hidden` を適用してフォーカス漏れを防ぐ。
 *
 * @param panels - Mapping from each {@link AppScreenId} to its root container element.
 * @param activeScreen - Currently visible screen identifier.
 * @param direction - Entrance animation hint (`"forward" | "back" | "none"`).
 */
export function applyScreenVisibility(
  panels: Readonly<Record<AppScreenId, HTMLElement>>,
  activeScreen: AppScreenId,
  direction: "forward" | "back" | "none" = "none"
): void {
  const entries = Object.entries(panels) as Array<[AppScreenId, HTMLElement]>;
  for (const [screenId, panel] of entries) {
    const isActive = screenId === activeScreen;
    panel.hidden = !isActive;
    panel.inert = !isActive;
    panel.setAttribute("aria-hidden", String(!isActive));
    panel.setAttribute("data-active", String(isActive));
    if (isActive && direction !== "none") {
      panel.setAttribute("data-nav-dir", direction);
    } else if (!isActive) {
      panel.removeAttribute("data-nav-dir");
    }
  }
}

/**
 * Moves focus safely after a drill-down or Back transition without causing jarring page scroll jumps.
 *
 * @param target - Element receiving focus (e.g., Back button or restoring trigger), or `null`.
 */
export function focusAfterNavigation(target: HTMLElement | null): void {
  if (!target || !target.isConnected) {
    return;
  }
  target.focus({ preventScroll: true });
}
