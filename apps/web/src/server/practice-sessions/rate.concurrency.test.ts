import { afterAll, beforeAll, expect, it } from "vitest";
import { getDb, schema } from "@ankify/db";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test-db";
import { runSessionCommand, startPracticeSession } from "./commands";
import { expectOnlyBusy, RACE_T0, raceStartInput } from "./race-fixtures";
import { ratePracticeSession } from "./scheduling";

const testDb = createTestDb();
const USER = "session-race";
const TAB = "00000000-0000-4000-8000-000000000001";
let sessionId: string;

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values({ id: USER, name: "Race", email: "race-rate@example.test" });
  await getDb().insert(schema.problems).values({
    id: "p-due", userId: USER, leetcodeSlug: "two-sum", leetcodeId: 1, title: "Two Sum", difficulty: "Easy",
    url: "https://leetcode.com/problems/two-sum/", fsrsState: "review", fsrsReps: 2, fsrsStability: 4, fsrsDifficulty: 5,
    fsrsLastReview: new Date(RACE_T0.getTime() - 5 * 86_400_000), fsrsDue: new Date(RACE_T0.getTime() - 3_600_000),
  });
  const started = await startPracticeSession(USER, { ...raceStartInput(crypto.randomUUID(), TAB), target: { kind: "problem", problemId: "p-due" }, mode: "due_review" }, RACE_T0);
  if (!started.ok) throw new Error(started.error);
  sessionId = started.response.session.id;
  const finishedAt = new Date(RACE_T0.getTime() + 600_000);
  const finished = await runSessionCommand(USER, sessionId, { type: "finish", requestId: crypto.randomUUID(), ownerToken: TAB, result: "solved", occurredAt: finishedAt.toISOString() }, finishedAt);
  if (!finished.ok) throw new Error(finished.error);
});
afterAll(() => testDb.cleanup());

it("schedules a review once when duplicated and distinct rating requests race", async () => {
  const now = new Date(RACE_T0.getTime() + 900_000);
  const duplicate = { requestId: crypto.randomUUID(), rating: 3 as const };
  const results = await Promise.allSettled([
    ratePracticeSession(USER, sessionId, duplicate, now),
    ratePracticeSession(USER, sessionId, duplicate, now),
    ratePracticeSession(USER, sessionId, { requestId: crypto.randomUUID(), rating: 1 }, now),
    ratePracticeSession(USER, sessionId, { requestId: crypto.randomUUID(), rating: 4 }, now),
  ]);
  expectOnlyBusy(results);
  expect(results.some((result) => result.status === "fulfilled" && result.value.ok)).toBe(true);
  const ratings = await getDb().select().from(schema.reviewEvents).where(eq(schema.reviewEvents.eventType, "self_recall_rated"));
  expect(ratings).toHaveLength(1);
  const [problem] = await getDb().select().from(schema.problems).where(eq(schema.problems.id, "p-due"));
  expect(problem).toMatchObject({ fsrsReps: 3, scheduleRevision: 1 });
});
