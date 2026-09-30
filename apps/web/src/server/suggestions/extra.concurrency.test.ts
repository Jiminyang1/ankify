import { afterAll, beforeAll, expect, it } from "vitest";
import { getDb, schema } from "@ankify/db";
import { expectOnlyBusy, RACE_T0 } from "../practice-sessions/race-fixtures";
import { upsertLeetcodeProblem } from "../problem-upsert";
import { createTestDb } from "../test-db";
import { allocateSuggestion } from "./commands";

const testDb = createTestDb();
const USER = "suggest-extra-race";

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values({ id: USER, name: "Race", email: "suggest-extra-race@example.test" });
  const similarQuestions = ["3sum", "4sum", "3sum-closest"].map((slug) => ({ slug, title: slug, difficulty: "Medium" as const, paidOnly: false }));
  await getDb().transaction((tx) =>
    upsertLeetcodeProblem(tx, USER, {
      leetcodeSlug: "two-sum", title: "Two Sum", difficulty: "Easy", url: "https://leetcode.com/problems/two-sum/",
      topicTags: [], similarSlugs: similarQuestions.map((question) => question.slug), similarQuestions,
    }, { enrollment: "enrolled", now: RACE_T0 }),
  );
});
afterAll(() => testDb.cleanup());

it("gives racing extra requests distinct slots and distinct targets", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => allocateSuggestion(USER, { requestId: crypto.randomUUID(), kind: "extra" }, RACE_T0)),
  );
  expectOnlyBusy(results);
  const rows = await getDb().select().from(schema.suggestions);
  expect(rows.length).toBeGreaterThan(0);
  expect(new Set(rows.map((row) => row.ordinal)).size).toBe(rows.length);
  expect(new Set(rows.map((row) => row.slug)).size).toBe(rows.length);
});
