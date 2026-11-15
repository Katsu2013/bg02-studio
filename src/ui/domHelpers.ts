/**
 * @module ui/domHelpers
 * Safe typed DOM factory utilities enforcing `textContent`-only rendering
 * to eliminate HTML/XSS injection vectors across UI components.
 */

import { createStudioIcon, type StudioIconName } from "./icons";

/** Attribute map passed when creating standard HTML elements cleanly. */
export interface ElementCreateOptions {
  /** Optional CSS class names appended to `className`. */
  readonly className?: string;
  /** Optional element `id` attribute. */
  readonly id?: string;
  /** Optional plain text written safely via `textContent`. */
  readonly text?: string;
  /** Optional generic ARIA or HTML attributes mapped via `setAttribute`. */
  readonly attrs?: Readonly<Record<string, string>>;
}

/**
 * Creates a typed HTML element safely without using `innerHTML`.
 *
 * // 意図: デバイス名やユーザーファイル名に `<` や `&` が含まれても安全に文字列描画できるよう、テキスト設定は常に `textContent` のみを使用する。
 *
 * @typeParam K - Tag key in `HTMLElementTagNameMap`.
 * @param tag - HTML tag name.
 * @param options - Optional class names, ID, text, and plain attributes.
 * @param children - Optional child nodes appended in order.
 * @returns Constructed DOM element.
 */
export function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementCreateOptions = {},
  children: ReadonlyArray<Node> = []
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (options.className) {
    el.className = options.className;
  }
  if (options.id) {
    el.id = options.id;
  }
  if (options.text !== undefined) {
    el.textContent = options.text;
  }
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      el.setAttribute(key, value);
    }
  }
  for (const child of children) {
    el.appendChild(child);
  }
  return el;
}

/**
 * References to an icon + label button constructed by {@link createIconButton}.
 */
export interface IconButtonHandle {
  /** Native `<button type="button">` control. */
  readonly button: HTMLButtonElement;
  /** Mutable label `<span>` preserving the sibling SVG icon during text updates. */
  readonly labelEl: HTMLSpanElement;
}

/**
 * Creates an accessible `<button type="button">` pairing an inline vector SVG icon
 * with a mutable text span so dynamic label changes never erase the SVG node.
 *
 * @param className - CSS class list (e.g. `"btn btn-primary"`).
 * @param iconName - Registered vector icon identifier.
 * @param text - Localized visible label text set via `textContent`.
 * @param iconSizePx - Square icon dimension in pixels (default `16`).
 * @returns Handle exposing both `button` and mutable `labelEl`.
 */
export function createIconButton(
  className: string,
  iconName: StudioIconName,
  text = "",
  iconSizePx = 16
): IconButtonHandle {
  const icon = createStudioIcon(iconName, iconSizePx);
  const labelEl = createEl("span", { className: "btn-label", text });
  const button = createEl("button", { className }, [icon, labelEl]);
  button.type = "button";
  return { button, labelEl };
}

/**
 * Creates a native `<button type="button">` preventing accidental form submission.
 *
 * @param className - CSS class list (e.g. `"btn btn-primary"`).
 * @param text - Button label set via `textContent`.
 * @returns Configured `HTMLButtonElement`.
 */
export function createButton(className: string, text = ""): HTMLButtonElement {
  const btn = createEl("button", { className, text });
  btn.type = "button";
  return btn;
}

/**
 * Replaces all children of a parent container cleanly without invoking HTML parsing.
 *
 * @param container - Target parent DOM element.
 * @param nodes - New child nodes to mount sequentially.
 */
export function replaceChildrenSafe(container: Element, nodes: ReadonlyArray<Node>): void {
  container.replaceChildren(...nodes);
}

/**
 * Queries a required DOM element inside `root` or throws an informative initialization error.
 *
 * @typeParam T - Expected subclass of `Element`.
 * @param root - Container or `Document` root to query.
 * @param selector - CSS selector string.
 * @returns Matching typed element.
 * @throws {Error} When no matching element exists.
 */
export function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) {
    throw new Error(`Required UI element not found: ${selector}`);
  }
  return found;
}
