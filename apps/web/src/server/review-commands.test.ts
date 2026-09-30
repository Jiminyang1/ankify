import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@ankify/db";
import { and, eq } from "drizzle-orm";
import { rateProblemReview, undoLatestProblemReview } from "./review-commands";
import { loadReviewQueueData } from "./review-queue-data";
import { createTestDb } from "./test-db";

const testDb = createTestDb();
const USER = "review-owner";
const request = { problemId: "p1", rating: 3 as const, requestId: "11111111-1111-4111-8111-111111111111" };
const memory = {
  fsrsDue: new Date("2026-01-01T00:00:00.000Z"), fsrsStability: 7.5,
  fsrsDifficulty: 5.2, fsrsElapsedDays: 4, fsrsScheduledDays: 7,
  fsrsLearningSteps: 0, fsrsReps: 4, fsrsLapses: 1, fsrsState: "review" as const,
  fsrsLastReview: new Date("2025-12-25T00:00:00.000Z"),
};
async function problem() {
  const [row] = await getDb().select().from(schema.problems)
    .where(and(eq(schema.problems.userId, USER), eq(schema.problems.id, "p1")));
  return row!;
}
beforeAll(() => testDb.migrate());
beforeEach(async () => {
  await getDb().delete(schema.user);
  await getDb().insert(schema.user).values([
    { id: USER, name: "Owner", email: "review@example.test" },
    { id: "other", name: "Other", email: "review-other@example.test" },
  ]);
  await getDb().insert(schema.problems).values([
    { id: "p1", userId: USER, leetcodeSlug: "two-sum", title: "Two Sum", difficulty: "Easy", url: "https://leetcode.com/problems/two-sum/", notes: "Original notes", ...memory },
    { id: "p2", userId: USER, leetcodeSlug: "3sum", title: "3Sum", difficulty: "Medium", url: "https://leetcode.com/problems/3sum/", archivedAt: new Date() },
    { id: "other-p1", userId: "other", leetcodeSlug: "two-sum", title: "Two Sum", difficulty: "Easy", url: "https://leetcode.com/problems/two-sum/", ...memory },
  ]);
  await getDb().insert(schema.settings).values({ userId: USER, key: "review", value: { dailyReviewLimit: 10, timeZone: "UTC" } });
});
afterAll(() => testDb.cleanup());

describe("legacy rating and Undo characterization", () => {
  it("rates once, persists before/after snapshots, and replays the original due date", async () => {
    const first = await rateProblemReview(USER, request);
    expect(first).toMatchObject({ ok: true, idempotentReplay: false, nextDue: expect.any(String), queue: { doneToday: 1 } });
    const rated = await problem();
    expect(rated.fsrsReps).toBe(memory.fsrsReps + 1);
    expect(await rateProblemReview(USER, request)).toEqual({ ...first, idempotentReplay: true });
    expect(await problem()).toEqual(rated);
    const events = await getDb().select().from(schema.reviewEvents).where(eq(schema.reviewEvents.userId, USER));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: "self_recall_rated", fsrsRating: 3, requestId: request.requestId,
      metadata: { undo: { reps: 4, due: memory.fsrsDue.toISOString() }, result: { nextDue: rated.fsrsDue!.toISOString() } } });
  });

  it("advances the schedule revision on every rating and Undo, recording legacy provenance", async () => {
    expect((await problem()).scheduleRevision).toBe(0);
    await rateProblemReview(USER, request);
    expect((await problem()).scheduleRevision).toBe(1);
    const [event] = await getDb().select().from(schema.reviewEvents).where(eq(schema.reviewEvents.userId, USER));
    expect(event).toMatchObject({ policyVersion: "legacy_self_recall_v1", reviewMethod: "self_recall", scheduleRevision: 1, practiceSessionId: null });
    await rateProblemReview(USER, request);
    expect((await problem()).scheduleRevision).toBe(1);
    await undoLatestProblemReview(USER, { problemId: "p1" });
    expect((await problem()).scheduleRevision).toBe(2);
  });

  it("refuses to rate a problem whose initial learning has not completed", async () => {
    await getDb().update(schema.problems).set({ enrollment: "awaiting_initial" })
      .where(and(eq(schema.problems.userId, USER), eq(schema.problems.id, "p1")));
    const before = await problem();
    expect(await rateProblemReview(USER, request)).toEqual({ ok: false, error: "problem_not_enrolled" });
    expect(await problem()).toEqual(before);
    expect(await getDb().select().from(schema.reviewEvents)).toEqual([]);
  });

  it("rejects reusing a request for another rating or problem", async () => {
    await rateProblemReview(USER, request);
    const rated = await problem();
    for (const conflicting of [{ ...request, rating: 1 as const }, { ...request, problemId: "p2" }]) {
      expect(await rateProblemReview(USER, conflicting)).toEqual({ ok: false, error: "review_request_conflict" });
    }
    expect(await problem()).toEqual(rated);
  });

  it("restores every memory field on Undo, retaining notes and the stamped review event", async () => {
    await rateProblemReview(USER, { ...request, notes: "Updated notes" });
    expect(await undoLatestProblemReview(USER, { problemId: "p1" })).toMatchObject({ ok: true, queue: { doneToday: 0, totalDue: 1 } });
    expect(await problem()).toMatchObject({ ...memory, notes: "Updated notes" });
    const events = await getDb().select().from(schema.reviewEvents).where(eq(schema.reviewEvents.userId, USER));
    expect(events).toHaveLength(1);
    expect(events[0]!.undoneAt).toBeInstanceOf(Date);
    expect(await rateProblemReview(USER, request)).toEqual({ ok: false, error: "review_request_conflict" });
    expect(await undoLatestProblemReview(USER, { problemId: "p1" })).toEqual({ ok: false, error: "nothing_to_undo" });
  });

  it("rejects another user's ratings and Undo requests", async () => {
    expect(await rateProblemReview("other", request)).toEqual({ ok: false, error: "problem_not_found" });
    await rateProblemReview(USER, request);
    const rated = await problem();
    expect(await undoLatestProblemReview("other", { problemId: "p1" })).toEqual({ ok: false, error: "problem_not_found" });
    expect(await problem()).toEqual(rated);
  });

  it("refuses Undo after a newer scheduling change, even one that keeps the repetition count", async () => {
    await rateProblemReview(USER, request);
    const rated = await problem();
    // Any other schedule write advances the revision; repetitions alone would
    // not reveal this one.
    await getDb().update(schema.problems).set({ fsrsDue: new Date("2027-01-01T00:00:00.000Z"), scheduleRevision: rated.scheduleRevision + 1 })
      .where(and(eq(schema.problems.userId, USER), eq(schema.problems.id, "p1")));
    expect(await undoLatestProblemReview(USER, { problemId: "p1" })).toEqual({ ok: false, error: "undo_conflict" });
  });

  it("undoes successive ratings newest first back to the original schedule", async () => {
    await rateProblemReview(USER, request);
    await rateProblemReview(USER, { ...request, rating: 1, requestId: "22222222-2222-4222-8222-222222222222" });
    expect(await undoLatestProblemReview(USER, { problemId: "p1" })).toMatchObject({ ok: true });
    expect(await undoLatestProblemReview(USER, { problemId: "p1" })).toMatchObject({ ok: true });
    expect(await problem()).toMatchObject({ ...memory, scheduleRevision: 4 });
    expect(await undoLatestProblemReview(USER, { problemId: "p1" })).toEqual({ ok: false, error: "nothing_to_undo" });
  });

  it("rolls back memory changes when inserting the review event fails", async () => {
    const before = await problem();
    await testDb.exec(`CREATE TRIGGER reject_rating BEFORE INSERT ON review_events
      WHEN NEW.event_type = 'self_recall_rated' BEGIN SELECT RAISE(ABORT, 'injected failure'); END;`);
    try {
      await expect(rateProblemReview(USER, request)).rejects.toThrow();
      expect(await problem()).toEqual(before);
      expect(await getDb().select().from(schema.reviewEvents)).toEqual([]);
    } finally {
      await testDb.exec("DROP TRIGGER reject_rating;");
    }
  });

  it("preserves the queue DTO, ready-card counts, stats-only reads, and user/archive filtering", async () => {
    await getDb().insert(schema.cards).values([
      { id: "ready", userId: USER, problemId: "p1", question: "Q", answer: "A", aiStatus: "ready" },
      { id: "candidate", userId: USER, problemId: "p1", question: "Q", answer: "A", aiStatus: "candidate" },
    ]);
    const result = await loadReviewQueueData(USER, 20);
    expect(result.queue).toEqual({ dailyReviewLimit: 10, doneToday: 0, remaining: 10, totalDue: 1, dueCount: 1 });
    expect(result.problems).toEqual([{
      id: "p1", leetcodeSlug: "two-sum", title: "Two Sum", difficulty: "Easy", url: "https://leetcode.com/problems/two-sum/",
      fsrsState: "review", fsrsDue: memory.fsrsDue.toISOString(), fsrsStability: 7.5, fsrsReps: 4, fsrsLapses: 1, cardCount: 1,
    }]);
    expect(await loadReviewQueueData(USER, 0)).toEqual({ queue: result.queue, problems: [] });
  });

  it("keeps problems awaiting initial learning out of the due queue", async () => {
    await getDb().update(schema.problems).set({ enrollment: "awaiting_initial", fsrsDue: null })
      .where(and(eq(schema.problems.userId, USER), eq(schema.problems.id, "p1")));
    const result = await loadReviewQueueData(USER, 20);
    expect(result.queue).toMatchObject({ totalDue: 0, dueCount: 0 });
    expect(result.problems).toEqual([]);
  });
});
