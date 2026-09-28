import { describe, expect, it } from "vitest";
import { translations } from "./i18n";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key));
}

describe("translations", () => {
  it("define the same keys in English and Chinese", () => {
    expect(keyPaths(translations.zh).sort()).toEqual(keyPaths(translations.en).sort());
  });

  it("format the credit strings with the same arguments in both languages", () => {
    for (const language of ["en", "zh"] as const) {
      const t = translations[language].settings;
      expect(t.creditsFree(3, 30)).toMatch(/3.*30/);
      expect(t.creditsPaid(42)).toContain("42");
      expect(t.paidActive(42)).toContain("42");
      expect(t.creditPack(100, "$5.00")).toMatch(/100.*\$5\.00/);
    }
  });
});
