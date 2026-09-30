import { describe, expect, it } from "vitest";
import { relativeDay, STRINGS } from "./i18n";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key));
}

describe("extension strings", () => {
  it("define the same keys in English and Chinese", () => {
    expect(keyPaths(STRINGS.zh).sort()).toEqual(keyPaths(STRINGS.en).sort());
  });

  it("explain every session error the panel and popup can show", () => {
    const codes = [
      "rating_pending", "open_session_conflict", "account_mismatch", "not_due", "not_enrolled", "problem_not_found",
      "not_owner", "session_stale", "invalid_transition", "rating_not_pending", "session_not_found", "problem_limit_reached",
      "duplicate_problem_conflict", "offline", "rate_limited", "server_error", "workflow_disabled", "signed_out",
    ];
    for (const language of ["en", "zh"] as const) {
      for (const code of codes) expect(STRINGS[language].errors[code], `${language}:${code}`).toBeTruthy();
    }
  });

  it("formats due dates relative to now in both languages", () => {
    const now = Date.parse("2026-09-29T12:00:00.000Z");
    expect(relativeDay("2026-09-30T12:00:00.000Z", "en", now)).toBe("tomorrow");
    expect(relativeDay("2026-10-02T12:00:00.000Z", "en", now)).toBe("in 3 days");
    expect(relativeDay("2026-09-30T12:00:00.000Z", "zh", now)).toBe("明天");
    expect(relativeDay(null, "en", now)).toBe("");
  });
});
