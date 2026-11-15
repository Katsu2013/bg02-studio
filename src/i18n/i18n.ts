/**
 * @module i18n/i18n
 * Locale auto-detection, persistence (`localStorage`), `<html lang>` synchronization,
 * template interpolation, and localized BG02 protocol error formatting.
 */

import { Bg02ProtocolError } from "../ble/types";
import { enDictionary } from "./en";
import { jaDictionary } from "./ja";
import type { LocaleCode, TranslationSchema } from "./types";

/** `localStorage` key storing the user's manual UI language override. */
export const LOCALE_STORAGE_KEY = "bg02-studio.locale";

/** Registered dictionaries keyed by canonical {@link LocaleCode}. */
export const LOCALE_DICTIONARIES: Readonly<Record<LocaleCode, TranslationSchema>> = {
  ja: jaDictionary,
  en: enDictionary,
};

/** Listener invoked whenever the active UI language changes. */
export type LocaleChangeListener = (locale: LocaleCode, dictionary: TranslationSchema) => void;

/**
 * Replaces `{placeholder}` tokens in a localized template string without HTML escaping.
 *
 * // 意図: UI 出力はすべて textContent 経由で行うため、補間関数は純粋な文字列置換のみを担当する。
 *
 * @param template - Localized string containing `{key}` placeholders.
 * @param params - Mapping of token names to scalar values.
 * @returns Interpolated plain text string.
 */
export function interpolate(
  template: string,
  params: Readonly<Record<string, string | number>>
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    const val = params[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

/**
 * Determines the initial locale from persisted preference first, then browser language settings.
 *
 * @param savedValue - Optional persisted locale code read from `localStorage`.
 * @param browserLanguages - Browser language list (e.g. `navigator.languages` / `navigator.language`).
 * @returns `"ja"` when explicitly stored or matching `ja*`, otherwise `"en"`.
 */
export function resolveInitialLocale(
  savedValue: string | null | undefined,
  browserLanguages: ReadonlyArray<string>
): LocaleCode {
  if (savedValue === "ja" || savedValue === "en") {
    return savedValue;
  }

  for (const lang of browserLanguages) {
    if (lang.toLowerCase().startsWith("ja")) {
      return "ja";
    }
  }

  return "en";
}

/**
 * Resolves a human-readable localized error description for any caught protocol or runtime error.
 *
 * @param err - Caught exception, optionally a {@link Bg02ProtocolError}.
 * @param dictionary - Active locale dictionary.
 * @returns Localized diagnostic error description suitable for UI display.
 */
export function formatErrorForUser(err: unknown, dictionary: TranslationSchema): string {
  if (err instanceof Bg02ProtocolError) {
    if (err.errorKey) {
      return dictionary.footer.dialErrors[err.errorKey];
    }
    if (err.statusCode !== undefined) {
      return interpolate(dictionary.footer.unknownDialError, { code: err.statusCode });
    }
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Stateful localization manager keeping `<html lang>` synchronized and notifying subscribed views.
 */
export class I18nService {
  /** Currently active locale code. */
  private currentLocale: LocaleCode;
  /** Registered callbacks triggered upon locale change. */
  private readonly listeners = new Set<LocaleChangeListener>();

  /**
   * Initializes localization using stored preference and browser environment defaults.
   *
   * @param initialLocale - Optional explicit locale override (skips auto-detection when set).
   */
  public constructor(initialLocale?: LocaleCode) {
    if (initialLocale) {
      this.currentLocale = initialLocale;
    } else {
      const stored = this.readStoredLocale();
      const browserLangs =
        typeof navigator !== "undefined"
          ? navigator.languages?.length
            ? Array.from(navigator.languages)
            : navigator.language
              ? [navigator.language]
              : []
          : [];
      this.currentLocale = resolveInitialLocale(stored, browserLangs);
    }
    this.syncDocumentLang();
  }

  /**
   * Returns the active locale identifier (`"ja"` or `"en"`).
   *
   * @returns Current {@link LocaleCode}.
   */
  public get locale(): LocaleCode {
    return this.currentLocale;
  }

  /**
   * Returns the strongly typed translation dictionary for the active locale.
   *
   * @returns Active {@link TranslationSchema}.
   */
  public get t(): TranslationSchema {
    return LOCALE_DICTIONARIES[this.currentLocale];
  }

  /**
   * Switches the active language, persists it to `localStorage`, updates `<html lang>`,
   * and notifies all subscribed UI components.
   *
   * @param nextLocale - Target locale (`"ja"` or `"en"`).
   */
  public setLocale(nextLocale: LocaleCode): void {
    if (nextLocale === this.currentLocale) {
      return;
    }
    this.currentLocale = nextLocale;
    this.writeStoredLocale(nextLocale);
    this.syncDocumentLang();
    const dict = this.t;
    for (const listener of this.listeners) {
      listener(nextLocale, dict);
    }
  }

  /**
   * Subscribes to locale change notifications.
   *
   * @param listener - Callback executed whenever {@link setLocale} changes the active language.
   * @returns Unsubscribe function detaching the listener.
   */
  public subscribe(listener: LocaleChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Synchronizes the root `<html>` `lang` attribute so screen readers and hyphenation match UI copy.
   */
  private syncDocumentLang(): void {
    if (typeof document !== "undefined" && document.documentElement) {
      // 意図: modern-web-guidance (html) に従い、言語切り替え時も常に <html lang> を実言語へ一致させる。
      document.documentElement.lang = this.currentLocale;
    }
  }

  /**
   * Reads saved locale preference from `localStorage` safely inside restricted environments.
   *
   * @returns Persisted string or `null`.
   */
  private readStoredLocale(): string | null {
    try {
      return typeof localStorage !== "undefined"
        ? localStorage.getItem(LOCALE_STORAGE_KEY)
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Persists chosen locale preference to `localStorage` safely.
   *
   * @param locale - Locale code to remember across visits.
   */
  private writeStoredLocale(locale: LocaleCode): void {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      }
    } catch {
      // Ignore storage quota or private-mode restrictions
    }
  }
}
