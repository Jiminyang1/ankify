import { afterAll, beforeAll, expect, it } from "vitest";
import { getDb, schema } from "@ankify/db";
import { expectOnlyBusy, RACE_T0 } from "../practice-sessions/race-fixtures";
import { upsertLeetcodeProblem } from "../problem-upsert";
import { createTestDb } from "../test-db";
import { allocateSuggestion } from "./commands";

const testDb = createTestDb();
const USER = "suggest-daily-race";

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values({ id: USER, name: "Race", email: "suggest-daily-race@example.test" });
  const similarQuestions = ["3sum", "4sum", "3sum-closest"].map((slug) => ({ slug, title: slug, difficulty: "Medium" as const, paidOnly: false }));
  await getDb().transaction((tx) =>
    upsertLeetcodeProblem(tx, USER, {
      leetcodeSlug: "two-sum", title: "Two Sum", difficulty: "Easy", url: "https://leetcode.com/problems/two-sum/",
      topicTags: [], similarSlugs: similarQuestions.map((question) => question.slug), similarQuestions,
    }, { enrollment: "enrolled", now: RACE_T0 }),
  );
});
afterAll(() => testDb.cleanup());

it("allocates one daily suggestion when requests race", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => allocateSuggestion(USER, { requestId: crypto.randomUUID(), kind: "daily" }, RACE_T0)),
  );
  expectOnlyBusy(results);
  const ids = results.flatMap((result) => (result.status === "fulfilled" && result.value.ok && result.value.response.suggestion ? [result.value.response.suggestion.id] : []));
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(1);
  expect(await getDb().select().from(schema.suggestions)).toHaveLength(1);
});
