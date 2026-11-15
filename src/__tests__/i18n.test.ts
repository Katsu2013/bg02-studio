import { describe, expect, it } from "vitest";
import { Bg02ProtocolError } from "../ble/types";
import { enDictionary } from "../i18n/en";
import { formatErrorForUser, interpolate, resolveInitialLocale } from "../i18n/i18n";
import { jaDictionary } from "../i18n/ja";

function collectLeafKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...collectLeafKeys(v as Record<string, unknown>, full));
    } else {
      keys.push(full);
    }
  }
  return keys.sort();
}

describe("i18n", () => {
  it("has identical leaf keys and non-empty strings in both ja and en dictionaries", () => {
    const jaKeys = collectLeafKeys(jaDictionary as unknown as Record<string, unknown>);
    const enKeys = collectLeafKeys(enDictionary as unknown as Record<string, unknown>);
    expect(jaKeys).toEqual(enKeys);
    expect(jaKeys.length).toBeGreaterThan(30);
  });

  it("resolves locale from persisted override first, then browser language list", () => {
    expect(resolveInitialLocale("en", ["ja-JP"])).toBe("en");
    expect(resolveInitialLocale("ja", ["en-US"])).toBe("ja");
    expect(resolveInitialLocale(null, ["ja-JP", "en-US"])).toBe("ja");
    expect(resolveInitialLocale(null, ["fr-FR", "en-US"])).toBe("en");
    expect(resolveInitialLocale("invalid", [])).toBe("en");
  });

  it("interpolates template tokens cleanly and leaves unknown tokens intact", () => {
    expect(interpolate("{width}x{height} px", { width: 240, height: 240 })).toBe("240x240 px");
    expect(interpolate("Hello {missing}", { name: "BG02" })).toBe("Hello {missing}");
  });

  it("maps Bg02ProtocolError semantic keys and unknown codes cleanly", () => {
    const lowBatErr = new Bg02ProtocolError("raw", 3, "lowBattery");
    expect(formatErrorForUser(lowBatErr, jaDictionary)).toContain("20%");
    expect(formatErrorForUser(lowBatErr, enDictionary)).toContain("20%");

    const chargingErr = new Bg02ProtocolError("raw", 4, "deviceCharging");
    expect(formatErrorForUser(chargingErr, jaDictionary)).toContain("充電中");
    expect(formatErrorForUser(chargingErr, enDictionary)).toContain("charging");

    const storageErr = new Bg02ProtocolError("raw", 5, "storageFull");
    expect(formatErrorForUser(storageErr, jaDictionary)).toContain("空き容量");
    expect(formatErrorForUser(storageErr, enDictionary)).toContain("storage");

    const unknownCodeErr = new Bg02ProtocolError("raw", 99);
    expect(formatErrorForUser(unknownCodeErr, enDictionary)).toContain("99");
  });
});
