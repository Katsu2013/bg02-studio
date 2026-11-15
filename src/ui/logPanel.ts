/**
 * @module ui/logPanel
 * Renders Panel 3: the chronological protocol & diagnostics console with clipboard copy
 * and clear actions while isolating dark monospace contrast cleanly across color schemes.
 */

import type { TranslationSchema } from "../i18n/types";
import type { AppStateSnapshot } from "../state/appStore";
import { createEl, createIconButton, type IconButtonHandle } from "./domHelpers";

/** Action handlers invoked by {@link LogPanel} user buttons. */
export interface LogPanelHandlers {
  /** Copies formatted log entries to clipboard cleanly and announces confirmation. */
  readonly onCopyLogs: () => void;
  /** Clears buffered communication logs from application state. */
  readonly onClearLogs: () => void;
}

/**
 * Stateful DOM controller rendering Panel 3 communication logs.
 */
export class LogPanel {
  /** Root `<section>` mounted inside `<main>`. */
  public readonly element: HTMLElement;
  /** Panel `<h2>` heading element. */
  private readonly headingEl: HTMLHeadingElement;
  /** Button copying buffered log lines to clipboard. */
  private readonly copyBtn: IconButtonHandle;
  /** Button clearing all buffered log lines. */
  private readonly clearBtn: IconButtonHandle;
  /** Preformatted monospace console container using `textContent` exclusively. */
  private readonly preEl: HTMLPreElement;
  /** Active translation dictionary. */
  private dict: TranslationSchema;
  /** Last rendered log count / tail signature used to avoid redundant scroll jumps. */
  private lastSignature = "";

  /**
   * Constructs the communication log viewer card.
   *
   * @param initialDict - Initial active locale dictionary.
   * @param handlers - Copy & clear action callbacks.
   */
  public constructor(initialDict: TranslationSchema, handlers: LogPanelHandlers) {
    this.dict = initialDict;

    this.headingEl = createEl("h2", { id: "log-panel-heading", text: initialDict.logs.heading });
    this.copyBtn = createIconButton("btn btn-sm", "copy", initialDict.logs.btnCopy, 15);
    this.clearBtn = createIconButton("btn btn-sm", "trash", initialDict.logs.btnClear, 15);

    this.copyBtn.button.addEventListener("click", () => handlers.onCopyLogs());
    this.clearBtn.button.addEventListener("click", () => handlers.onClearLogs());

    const actionsRow = createEl("div", { className: "btn-row" }, [
      this.copyBtn.button,
      this.clearBtn.button,
    ]);
    const headerRow = createEl("div", { className: "panel-heading-row" }, [
      this.headingEl,
      actionsRow,
    ]);

    this.preEl = createEl("pre", {
      className: "log-pre",
      text: initialDict.logs.emptyState,
      attrs: { "aria-live": "off", tabindex: "0" },
    });

    this.element = createEl(
      "section",
      {
        className: "panel-card",
        attrs: { "aria-labelledby": "log-panel-heading" },
      },
      [headerRow, this.preEl]
    );
  }

  /**
   * Updates localized headings/button labels and re-renders log display.
   *
   * @param nextDict - Newly activated locale dictionary.
   * @param state - Current application state snapshot.
   */
  public updateLocale(nextDict: TranslationSchema, state: AppStateSnapshot): void {
    this.dict = nextDict;
    this.headingEl.textContent = nextDict.logs.heading;
    this.copyBtn.labelEl.textContent = nextDict.logs.btnCopy;
    this.clearBtn.labelEl.textContent = nextDict.logs.btnClear;
    this.lastSignature = "";
    this.render(state);
  }

  /**
   * Synchronizes the monospace log readout and scrolls cleanly to newest lines when appended.
   *
   * @param state - Latest immutable store snapshot.
   */
  public render(state: AppStateSnapshot): void {
    const logs = state.logs;
    const hasLogs = logs.length > 0;
    this.copyBtn.button.disabled = !hasLogs;
    this.clearBtn.button.disabled = !hasLogs;

    const tailId = hasLogs ? logs[logs.length - 1].id : 0;
    const signature = `${logs.length}:${tailId}`;
    if (signature === this.lastSignature) {
      return;
    }
    this.lastSignature = signature;

    if (!hasLogs) {
      this.preEl.textContent = this.dict.logs.emptyState;
      return;
    }

    this.preEl.textContent = logs
      .map((entry) => `[${entry.timestamp}] ${entry.message}`)
      .join("\n");
    this.preEl.scrollTop = this.preEl.scrollHeight;
  }
}
