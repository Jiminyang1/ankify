import type { PracticeSessionStartInput } from "@ankify/contracts";
import { expect } from "vitest";

// Shared by the *.concurrency.test.ts files. Each race lives in its own file:
// in-process contention against local SQLite fails fast with SQLITE_BUSY and
// can leave that file's connection locked (see ai-credits.concurrency.test.ts).
// These tests prove the failure mode is safe, not Turso's serialization.
export const RACE_T0 = new Date("2026-09-29T12:00:00.000Z");

export function raceStartInput(requestId: string, ownerToken: string): PracticeSessionStartInput {
  return {
    requestId,
    ownerToken,
    mode: "practice",
    target: {
      kind: "leetcode",
      problem: {
        leetcodeSlug: "two-sum",
        leetcodeId: 1,
        title: "Two Sum",
        difficulty: "Easy",
        url: "https://leetcode.com/problems/two-sum/",
        topicTags: [],
        similarSlugs: [],
      },
    },
    baseline: { state: "none" },
    supersedePendingRating: false,
  };
}

/** Every contender either succeeded or lost the write lock; nothing else. */
export function expectOnlyBusy(results: PromiseSettledResult<unknown>[]) {
  for (const result of results) {
    if (result.status === "rejected") {
      const error = result.reason as Error & { code?: string; cause?: { code?: string } };
      expect(`${error.code} ${error.cause?.code} ${error.message}`).toMatch(/SQLITE_BUSY|database is locked/i);
    }
  }
}
