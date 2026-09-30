import { afterAll, beforeAll, expect, it } from "vitest";
import { getDb, schema } from "@ankify/db";
import { loadNextReview } from "./next-review";
import { loadProblemsList } from "./problems-list";
import { createTestDb } from "./test-db";

// Legacy web surfaces stay truthful about problems whose initial learning has
// not completed: listed as unscheduled, never counted or opened as due.
const testDb = createTestDb();
const USER = "enrollment-owner";

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values({ id: USER, name: "Owner", email: "enrollment@example.test" });
  await getDb().insert(schema.problems).values([
    { id: "enrolled", userId: USER, leetcodeSlug: "a", title: "A", difficulty: "Easy", url: "https://leetcode.com/problems/a/", fsrsDue: new Date(Date.now() - 60_000) },
    { id: "awaiting", userId: USER, leetcodeSlug: "b", title: "B", difficulty: "Easy", url: "https://leetcode.com/problems/b/", fsrsDue: null, enrollment: "awaiting_initial" },
  ]);
});
afterAll(() => testDb.cleanup());

it("lists enrollment and leaves problems awaiting initial learning out of the due count", async () => {
  const list = await loadProblemsList(USER);
  expect(list.dueCount).toBe(1);
  expect(Object.fromEntries(list.problems.map((problem) => [problem.id, problem.enrollment]))).toEqual({
    enrolled: "enrolled",
    awaiting: "awaiting_initial",
  });
});

it("never opens a problem awaiting initial learning for a legacy review", async () => {
  expect((await loadNextReview(USER, "awaiting")).problem).toBeNull();
  expect((await loadNextReview(USER, "enrolled")).problem?.id).toBe("enrolled");
  expect((await loadNextReview(USER)).problem?.id).toBe("enrolled");
});
