import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PracticeSessionStartInput } from "@ankify/contracts";
import { rateFullSolve } from "@ankify/core";
import { getDb, schema } from "@ankify/db";
import { and, eq } from "drizzle-orm";
import { problemFsrsState, rateProblemReview, undoLatestProblemReview } from "../review-commands";
import { getReviewQueueStatus } from "../review-queue";
import { loadReviewQueueData } from "../review-queue-data";
import { setReviewSettings } from "../settings";
import { createTestDb } from "../test-db";
import { ingestSessionObservations, runSessionCommand, startPracticeSession } from "./commands";
import { ratePracticeSession } from "./scheduling";

const testDb = createTestDb();
const USER = "scheduling-owner";
const TAB = "aaaaaaaa-0000-4000-8000-00000000000a";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// Real-clock anchor: queue and daily counts read the current time.
const T0 = new Date(Math.floor(Date.now() / MIN) * MIN - 3 * DAY);
const at = (ms: number) => new Date(T0.getTime() + ms);
const uuid = () => crypto.randomUUID();

const problemRow = async (id: string) =>
  (await getDb().select().from(schema.problems).where(and(eq(schema.problems.id, id), eq(schema.problems.userId, USER))))[0]!;
const sessionRow = async (id: string) =>
  (await getDb().select().from(schema.practiceSessions).where(eq(schema.practiceSessions.id, id)))[0]!;
const events = async (problemId: string) =>
  getDb().select().from(schema.reviewEvents).where(and(eq(schema.reviewEvents.userId, USER), eq(schema.reviewEvents.problemId, problemId)));

function scheduling(row: Awaited<ReturnType<typeof problemRow>>) {
  return {
    fsrsDue: row.fsrsDue, fsrsStability: row.fsrsStability, fsrsDifficulty: row.fsrsDifficulty,
    fsrsElapsedDays: row.fsrsElapsedDays, fsrsScheduledDays: row.fsrsScheduledDays, fsrsLearningSteps: row.fsrsLearningSteps,
    fsrsReps: row.fsrsReps, fsrsLapses: row.fsrsLapses, fsrsState: row.fsrsState, fsrsLastReview: row.fsrsLastReview,
  };
}

async function start(overrides: Partial<PracticeSessionStartInput>, now: Date) {
  const result = await startPracticeSession(USER, {
    requestId: uuid(),
    target: { kind: "leetcode", problem: { leetcodeSlug: "two-sum", leetcodeId: 1, title: "Two Sum", difficulty: "Easy", url: "https://leetcode.com/problems/two-sum/", topicTags: [], similarSlugs: [] } },
    mode: "practice",
    ownerToken: TAB,
    baseline: { state: "none" },
    supersedePendingRating: false,
    ...overrides,
  }, now);
  if (!result.ok) throw new Error(`start failed: ${result.error}`);
  return result.response;
}

async function finish(sessionId: string, now: Date, result: "solved" | "unsuccessful" = "solved") {
  const response = await runSessionCommand(USER, sessionId, { type: "finish", requestId: uuid(), ownerToken: TAB, result, occurredAt: now.toISOString() }, now);
  if (!response.ok) throw new Error(`finish failed: ${response.error}`);
  return response.response;
}

async function insertDueProblem(id: string, slug: string, extra: Partial<typeof schema.problems.$inferInsert> = {}) {
  await getDb().insert(schema.problems).values({
    id, userId: USER, leetcodeSlug: slug, title: slug, difficulty: "Medium", url: `https://leetcode.com/problems/${slug}/`,
    fsrsState: "review", fsrsReps: 3, fsrsLapses: 0, fsrsStability: 6, fsrsDifficulty: 5, fsrsElapsedDays: 6, fsrsScheduledDays: 6,
    fsrsLastReview: at(-6 * DAY), fsrsDue: at(-HOUR), ...extra,
  });
}

/** A completed due review of `problemId`, finished 20 minutes after start. */
async function completedReview(problemId: string, startAt = T0, result: "solved" | "unsuccessful" = "solved") {
  const { session } = await start({ target: { kind: "problem", problemId }, mode: "due_review" }, startAt);
  await finish(session.id, new Date(startAt.getTime() + 20 * MIN), result);
  return session.id;
}

beforeAll(() => testDb.migrate());
beforeEach(async () => {
  await getDb().delete(schema.user);
  await getDb().insert(schema.user).values({ id: USER, name: "Owner", email: "scheduling@example.test" });
});
afterAll(() => testDb.cleanup());

describe("initial learning", () => {
  it("schedules the first review a day after completion without inventing a rating", async () => {
    const { session, problem } = await start({}, T0);
    await finish(session.id, at(30 * MIN), "unsuccessful");
    const row = await problemRow(problem.id);
    expect(row).toMatchObject({ enrollment: "enrolled", fsrsState: "new", fsrsReps: 0, fsrsLastReview: null, scheduleRevision: 1 });
    expect(row.fsrsDue).toEqual(at(30 * MIN + DAY));
    const history = await events(problem.id);
    expect(history.map((event) => event.eventType).sort()).toEqual(["fsrs_scheduled", "problem_captured"]);
    expect(history.find((event) => event.eventType === "fsrs_scheduled")).toMatchObject({
      practiceSessionId: session.id, policyVersion: "initial_delay_v1", reviewMethod: "leetcode_full_solve",
      scheduleRevision: 1, fsrsRating: null, occurredAt: at(30 * MIN),
    });
    // Due since T0 + 1 day, so it is in today's queue; initial learning is not a review.
    expect((await loadReviewQueueData(USER, 20)).problems.map((item) => item.id)).toEqual([problem.id]);
    expect((await getReviewQueueStatus(USER)).doneToday).toBe(0);
  });

  it("honors the configured initial review delay", async () => {
    await setReviewSettings(USER, { initialReviewDelayHours: 48 });
    const { session, problem } = await start({}, T0);
    await finish(session.id, at(MIN));
    expect((await problemRow(problem.id)).fsrsDue).toEqual(at(MIN + 48 * HOUR));
  });

  it("never schedules from abandoned or interrupted initial learning", async () => {
    const abandoned = await start({}, T0);
    await runSessionCommand(USER, abandoned.session.id, { type: "abandon", requestId: uuid(), ownerToken: TAB, occurredAt: at(MIN).toISOString() }, at(MIN));
    expect(await problemRow(abandoned.problem.id)).toMatchObject({ enrollment: "awaiting_initial", fsrsDue: null, scheduleRevision: 0 });

    // An interrupted session goes stale; the next start is initial learning again.
    const interrupted = await start({}, at(2 * MIN));
    const retry = await start({}, at(2 * MIN + 25 * HOUR));
    expect(retry.session).toMatchObject({ type: "initial_learning" });
    expect(retry.session.id).not.toBe(interrupted.session.id);
    expect(await problemRow(abandoned.problem.id)).toMatchObject({ enrollment: "awaiting_initial", fsrsDue: null });
    expect((await events(abandoned.problem.id)).map((event) => event.eventType)).toEqual(["problem_captured"]);
  });
});

describe("session ratings", () => {
  it("rates a completed review once, scheduling from its completion time even when rated later", async () => {
    await insertDueProblem("p1", "one");
    const before = await problemRow("p1");
    const sessionId = await completedReview("p1");
    const completedAt = at(20 * MIN);
    const ratedAt = at(20 * MIN + 20 * HOUR);
    const result = await ratePracticeSession(USER, sessionId, { requestId: uuid(), rating: 3 }, ratedAt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expected = rateFullSolve(problemFsrsState(before), 3, completedAt).next;
    const after = await problemRow("p1");
    expect(scheduling(after)).toEqual(scheduling({ ...after, ...{
      fsrsDue: expected.due, fsrsStability: expected.stability, fsrsDifficulty: expected.difficulty, fsrsElapsedDays: expected.elapsedDays,
      fsrsScheduledDays: expected.scheduledDays, fsrsLearningSteps: expected.learningSteps, fsrsReps: expected.reps, fsrsLapses: expected.lapses,
      fsrsState: expected.state, fsrsLastReview: expected.lastReview,
    } }));
    expect(after).toMatchObject({ fsrsLastReview: completedAt, fsrsReps: 4, fsrsState: "review", scheduleRevision: 1 });
    expect(result.response).toMatchObject({
      nextDue: expected.due!.toISOString(),
      problem: { scheduleRevision: 1, due: false },
      session: { rating: { disposition: "submitted" } },
      idempotentReplay: false,
    });
    const [rating] = (await events("p1")).filter((event) => event.eventType === "self_recall_rated");
    expect(rating).toMatchObject({
      practiceSessionId: sessionId, fsrsRating: 3, policyVersion: "leetcode_full_solve_v1", reviewMethod: "leetcode_full_solve",
      scheduleRevision: 1, occurredAt: completedAt, metadata: { ratedAt: ratedAt.toISOString(), undo: { reps: 3 } },
    });
  });

  it("replays a lost response without rescheduling and refuses any second rating of the session", async () => {
    await insertDueProblem("p1", "one");
    const sessionId = await completedReview("p1");
    const input = { requestId: uuid(), rating: 3 as const };
    const first = await ratePracticeSession(USER, sessionId, input, at(HOUR));
    const rated = await problemRow("p1");
    const replay = await ratePracticeSession(USER, sessionId, input, at(2 * HOUR));
    expect(first.ok && replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(replay.response).toEqual({ ...first.response, idempotentReplay: true });
    expect(await ratePracticeSession(USER, sessionId, { ...input, rating: 4 }, at(2 * HOUR))).toEqual({ ok: false, error: "request_conflict" });
    expect(await ratePracticeSession(USER, sessionId, { requestId: uuid(), rating: 1 }, at(2 * HOUR)))
      .toMatchObject({ ok: false, error: "rating_not_pending", session: { rating: { disposition: "submitted" } } });
    expect(await problemRow("p1")).toEqual(rated);
    expect((await events("p1")).filter((event) => event.eventType === "self_recall_rated")).toHaveLength(1);
  });

  it("refuses a rating whose problem was rescheduled since the session started", async () => {
    await insertDueProblem("p1", "one");
    const sessionId = await completedReview("p1");
    await rateProblemReview(USER, { problemId: "p1", rating: 4, requestId: uuid() });
    const legacy = await problemRow("p1");
    expect(await ratePracticeSession(USER, sessionId, { requestId: uuid(), rating: 3 }, at(HOUR)))
      .toMatchObject({ ok: false, error: "rating_not_pending", session: { rating: { disposition: "superseded" } } });
    expect((await sessionRow(sessionId)).ratingDisposition).toBe("superseded");
    expect(await problemRow("p1")).toEqual(legacy);
  });

  it("undoes a session rating, after which the session can never be rated again", async () => {
    await insertDueProblem("p1", "one");
    const before = await problemRow("p1");
    const sessionId = await completedReview("p1");
    const rating = { requestId: uuid(), rating: 2 as const };
    await ratePracticeSession(USER, sessionId, rating, at(HOUR));
    const undone = await runSessionCommand(USER, sessionId, { type: "undo_rating", requestId: uuid() }, at(2 * HOUR));
    expect(undone).toMatchObject({ ok: true, response: { session: { rating: { disposition: "undone" } } } });
    const restored = await problemRow("p1");
    expect(scheduling(restored)).toEqual(scheduling(before));
    expect(restored.scheduleRevision).toBe(2);
    expect((await events("p1")).find((event) => event.eventType === "self_recall_rated")!.undoneAt).toEqual(at(2 * HOUR));

    expect(await ratePracticeSession(USER, sessionId, rating, at(3 * HOUR))).toMatchObject({ ok: false, error: "rating_not_pending" });
    expect(await ratePracticeSession(USER, sessionId, { requestId: uuid(), rating: 3 }, at(3 * HOUR))).toMatchObject({ ok: false, error: "rating_not_pending" });
    expect(await runSessionCommand(USER, sessionId, { type: "undo_rating", requestId: uuid() }, at(3 * HOUR))).toMatchObject({ ok: false, error: "nothing_to_undo" });
    expect(scheduling(await problemRow("p1"))).toEqual(scheduling(before));
  });

  it("marks the session undone when the legacy Undo route reverts its rating, and refuses Undo after a newer change", async () => {
    await insertDueProblem("p1", "one");
    await insertDueProblem("p2", "two");
    const s1 = await completedReview("p1");
    await ratePracticeSession(USER, s1, { requestId: uuid(), rating: 3 }, at(HOUR));
    expect(await undoLatestProblemReview(USER, { problemId: "p1" })).toMatchObject({ ok: true });
    expect((await sessionRow(s1)).ratingDisposition).toBe("undone");

    const s2 = await completedReview("p2");
    await ratePracticeSession(USER, s2, { requestId: uuid(), rating: 3 }, at(HOUR));
    await rateProblemReview(USER, { problemId: "p2", rating: 1, requestId: uuid() });
    expect(await runSessionCommand(USER, s2, { type: "undo_rating", requestId: uuid() }, at(2 * HOUR))).toMatchObject({ ok: false, error: "undo_conflict" });
  });

  it("lets a review ended unsuccessfully be rated Again", async () => {
    await insertDueProblem("p1", "one");
    const sessionId = await completedReview("p1", T0, "unsuccessful");
    expect((await sessionRow(sessionId)).outcome).toBe("failed");
    const result = await ratePracticeSession(USER, sessionId, { requestId: uuid(), rating: 1 }, at(HOUR));
    expect(result.ok).toBe(true);
    expect(await problemRow("p1")).toMatchObject({ fsrsLapses: 1, fsrsState: "review" });
    const row = await problemRow("p1");
    expect(row.fsrsDue!.getTime() - at(20 * MIN).getTime()).toBeGreaterThanOrEqual(DAY);
  });

  it("rates deferred and early reviews, but never dismissed, expired, voluntary, abandoned, or unfinished sessions", async () => {
    for (const [id, slug] of [["p1", "one"], ["p2", "two"], ["p3", "three"], ["p4", "four"], ["p5", "five"], ["p6", "six"]] as const) {
      await insertDueProblem(id, slug);
    }
    await insertDueProblem("p-early", "early", { fsrsDue: at(5 * DAY) });
    const rate = (sessionId: string, now: Date) => ratePracticeSession(USER, sessionId, { requestId: uuid(), rating: 3 }, now);

    const deferred = await completedReview("p1");
    await runSessionCommand(USER, deferred, { type: "defer_rating", requestId: uuid() }, at(HOUR));
    expect((await rate(deferred, at(10 * HOUR))).ok).toBe(true);

    const early = await start({ target: { kind: "problem", problemId: "p-early" }, mode: "early_review" }, T0);
    await finish(early.session.id, at(10 * MIN));
    expect((await rate(early.session.id, at(HOUR))).ok).toBe(true);

    const untouched = new Map<string, Awaited<ReturnType<typeof problemRow>>>();
    for (const id of ["p2", "p3", "p4", "p5", "p6"]) untouched.set(id, await problemRow(id));

    const dismissed = await completedReview("p2");
    await runSessionCommand(USER, dismissed, { type: "dismiss_rating", requestId: uuid() }, at(HOUR));
    expect(await rate(dismissed, at(2 * HOUR))).toMatchObject({ ok: false, error: "rating_not_pending" });

    const expired = await completedReview("p3");
    expect(await rate(expired, at(20 * MIN + DAY + 1))).toMatchObject({ ok: false, error: "rating_not_pending", session: { rating: { disposition: "expired" } } });

    const voluntary = await start({ target: { kind: "problem", problemId: "p4" } }, T0);
    await finish(voluntary.session.id, at(10 * MIN));
    expect(await rate(voluntary.session.id, at(HOUR))).toMatchObject({ ok: false, error: "rating_not_pending" });

    const abandoned = await start({ target: { kind: "problem", problemId: "p5" }, mode: "due_review" }, T0);
    await runSessionCommand(USER, abandoned.session.id, { type: "abandon", requestId: uuid(), ownerToken: TAB, occurredAt: at(MIN).toISOString() }, at(MIN));
    expect(await rate(abandoned.session.id, at(HOUR))).toMatchObject({ ok: false, error: "rating_not_pending" });

    const open = await start({ target: { kind: "problem", problemId: "p6" }, mode: "due_review" }, T0);
    await ingestSessionObservations(USER, open.session.id, { observations: [{ leetcodeSubmissionId: "7001", verdict: "Accepted", submittedAt: at(MIN).toISOString() }] }, at(MIN));
    expect(await rate(open.session.id, at(2 * MIN))).toMatchObject({ ok: false, error: "rating_not_pending" });

    for (const [id, row] of untouched) expect(scheduling(await problemRow(id))).toEqual(scheduling(row));
  });

  it("counts session ratings, not initial learning, toward today's reviews", async () => {
    // Within today (UTC, the default time zone) even just after midnight.
    const today = new Date(Math.max(new Date().setUTCHours(0, 0, 0, 0), Date.now() - 30 * MIN));
    await insertDueProblem("p1", "one");
    const { session } = await start({ target: { kind: "problem", problemId: "p1" }, mode: "due_review" }, today);
    await finish(session.id, new Date(today.getTime() + 10 * MIN));
    const initial = await start({ target: { kind: "leetcode", problem: { leetcodeSlug: "3sum", leetcodeId: 15, title: "3Sum", difficulty: "Medium", url: "https://leetcode.com/problems/3sum/", topicTags: [], similarSlugs: [] } } }, today);
    await finish(initial.session.id, new Date(today.getTime() + 10 * MIN));
    expect((await getReviewQueueStatus(USER)).doneToday).toBe(0);
    await ratePracticeSession(USER, session.id, { requestId: uuid(), rating: 3 }, new Date(today.getTime() + 15 * MIN));
    expect((await getReviewQueueStatus(USER)).doneToday).toBe(1);
  });
});
