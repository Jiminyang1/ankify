import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  PracticeSessionCommandInput,
  PracticeSessionStartInput,
  PracticeSessionSubmissionsInput,
} from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { and, eq } from "drizzle-orm";
import { iterateAccountExport } from "../account-export";
import { captureProblem } from "../capture";
import { MAX_SUBMISSIONS_PER_PROBLEM } from "../resource-limits";
import { rateProblemReview } from "../review-commands";
import { loadReviewQueueData } from "../review-queue-data";
import { createTestDb } from "../test-db";
import { ingestSessionObservations, runSessionCommand, startPracticeSession } from "./commands";
import { getCurrentPracticeSession, getPracticeSessionDetail, listPracticeSessions } from "./queries";

const testDb = createTestDb();
const USER = "session-owner";
const OTHER = "session-other";
const TAB_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const TAB_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T0 = new Date("2026-09-29T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const uuid = () => crypto.randomUUID();

const meta = (slug: string, leetcodeId: number) => ({
  leetcodeSlug: slug,
  leetcodeId,
  title: slug,
  difficulty: "Medium" as const,
  url: `https://leetcode.com/problems/${slug}/`,
  topicTags: ["Array"],
  similarSlugs: [],
});

function startInput(overrides: Partial<PracticeSessionStartInput> = {}): PracticeSessionStartInput {
  return {
    requestId: uuid(),
    target: { kind: "leetcode", problem: meta("two-sum", 1) },
    mode: "practice",
    ownerToken: TAB_A,
    baseline: { state: "established", leetcodeSubmissionId: "1000" },
    supersedePendingRating: false,
    ...overrides,
  };
}

async function start(overrides: Partial<PracticeSessionStartInput> = {}, now = T0, userId = USER) {
  const result = await startPracticeSession(userId, startInput(overrides), now);
  if (!result.ok) throw new Error(`start failed: ${result.error}`);
  return result.response;
}

async function command(sessionId: string, input: PracticeSessionCommandInput, now: Date, userId = USER) {
  return runSessionCommand(userId, sessionId, input, now);
}

const finish = (sessionId: string, now: Date, overrides: Partial<Extract<PracticeSessionCommandInput, { type: "finish" }>> = {}) =>
  command(sessionId, { type: "finish", requestId: uuid(), ownerToken: TAB_A, result: "solved", occurredAt: now.toISOString(), ...overrides }, now);

async function observe(sessionId: string, observations: PracticeSessionSubmissionsInput["observations"], now: Date, userId = USER) {
  const result = await ingestSessionObservations(userId, sessionId, { observations }, now);
  if (!result.ok) throw new Error(`ingest failed: ${result.error}`);
  return result.response;
}

async function insertProblem(id: string, slug: string, fsrsDue: Date | null, extra: Partial<typeof schema.problems.$inferInsert> = {}) {
  await getDb().insert(schema.problems).values({
    id,
    userId: USER,
    leetcodeSlug: slug,
    title: slug,
    difficulty: "Easy",
    url: `https://leetcode.com/problems/${slug}/`,
    fsrsDue,
    fsrsState: "review",
    fsrsReps: 3,
    fsrsStability: 5,
    fsrsDifficulty: 5,
    fsrsLastReview: at(-5 * 24 * HOUR),
    ...extra,
  });
}

const problemRow = async (id: string) =>
  (await getDb().select().from(schema.problems).where(and(eq(schema.problems.id, id), eq(schema.problems.userId, USER))))[0]!;
const sessionRow = async (id: string) =>
  (await getDb().select().from(schema.practiceSessions).where(eq(schema.practiceSessions.id, id)))[0]!;

beforeAll(() => testDb.migrate());
beforeEach(async () => {
  await getDb().delete(schema.user);
  await getDb().insert(schema.user).values([
    { id: USER, name: "Owner", email: "sessions@example.test" },
    { id: OTHER, name: "Other", email: "sessions-other@example.test" },
  ]);
});
afterAll(() => testDb.cleanup());

describe("starting practice sessions", () => {
  it("creates an unscheduled problem and an initial-learning session for a problem new to Ankify", async () => {
    const response = await start({ baseline: { state: "none" } });
    expect(response).toMatchObject({
      ok: true,
      created: true,
      problemCreated: true,
      unarchived: false,
      idempotentReplay: false,
      problem: { leetcodeSlug: "two-sum", enrollment: "awaiting_initial", due: false, fsrsDue: null, scheduleRevision: 0 },
      session: {
        type: "initial_learning",
        reviewIntent: "none",
        reviewMethod: "leetcode_full_solve",
        status: "active",
        stale: false,
        ownership: "you",
        outcome: null,
        rating: { disposition: "not_applicable", expiresAt: null },
        capture: { completeness: "complete", baselineState: "none" },
        timing: { startedAt: T0.toISOString(), wallMs: 0, activeMs: 0, observedMs: 0 },
      },
    });
    const problem = await problemRow(response.problem.id);
    expect(problem).toMatchObject({ enrollment: "awaiting_initial", fsrsDue: null, fsrsState: "new", fsrsReps: 0, fsrsLastReview: null });
    expect((await loadReviewQueueData(USER, 20)).queue.totalDue).toBe(0);
    const events = await getDb().select().from(schema.reviewEvents).where(eq(schema.reviewEvents.userId, USER));
    expect(events.map((event) => event.eventType)).toEqual(["problem_captured"]);
  });

  it("replays a start with the same request and rejects a changed payload under that id", async () => {
    const input = startInput();
    const first = await startPracticeSession(USER, input, T0);
    const replay = await startPracticeSession(USER, input, at(5_000));
    expect(first.ok && replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(replay.response).toEqual({ ...first.response, idempotentReplay: true });
    expect(await startPracticeSession(USER, { ...input, ownerToken: TAB_B }, at(6_000))).toEqual({ ok: false, error: "request_conflict" });
    expect(await getDb().select().from(schema.practiceSessions)).toHaveLength(1);
    expect(await getDb().select().from(schema.practiceSessionCommands)).toHaveLength(1);
  });

  it("keeps practice on an enrolled problem voluntary and requires an explicit, valid review choice", async () => {
    await insertProblem("p-future", "future", at(3 * 24 * HOUR));
    await insertProblem("p-due", "due", at(-HOUR));
    const target = (problemId: string) => ({ kind: "problem" as const, problemId });

    expect(await startPracticeSession(USER, startInput({ target: target("p-future"), mode: "due_review" }), T0)).toEqual({ ok: false, error: "not_due" });
    const practice = await start({ target: target("p-future") });
    expect(practice.session).toMatchObject({ type: "voluntary_practice", reviewIntent: "none" });
    await command(practice.session.id, { type: "abandon", requestId: uuid(), ownerToken: TAB_A, occurredAt: T0.toISOString() }, T0);
    const early = await start({ target: target("p-future"), mode: "early_review" }, at(MIN));
    expect(early.session).toMatchObject({ type: "scheduled_review", reviewIntent: "early" });

    const due = await start({ target: target("p-due"), mode: "due_review" });
    expect(due.session).toMatchObject({ type: "scheduled_review", reviewIntent: "due" });
    expect(due.problem).toMatchObject({ due: true, enrollment: "enrolled" });
  });

  it("never creates or modifies a problem when a review request is rejected", async () => {
    expect(await startPracticeSession(USER, startInput({ mode: "due_review" }), T0)).toEqual({ ok: false, error: "problem_not_found" });
    expect(await getDb().select().from(schema.problems)).toEqual([]);
    const awaiting = await start();
    expect(await startPracticeSession(USER, startInput({ mode: "early_review" }), at(MIN))).toEqual({ ok: false, error: "not_enrolled" });
    expect((await problemRow(awaiting.problem.id)).updatedAt).toEqual(T0);
  });

  it("resumes the open session of the same kind and claims it only when no other tab holds it", async () => {
    const first = await start();
    await command(first.session.id, { type: "heartbeat", ownerToken: TAB_A, activeMs: 4_000, observedMs: 9_000 }, at(10_000));
    const again = await start({}, at(15_000));
    expect(again).toMatchObject({ created: false, session: { id: first.session.id, ownership: "you" } });

    const elsewhere = await start({ ownerToken: TAB_B }, at(20_000));
    expect(elsewhere).toMatchObject({ created: false, session: { id: first.session.id, ownership: "other_tab" } });
    expect((await sessionRow(first.session.id)).ownerToken).toBe(TAB_A);

    const claimed = await start({ ownerToken: TAB_B }, at(3 * MIN));
    expect(claimed).toMatchObject({ created: false, session: { id: first.session.id, ownership: "you", status: "active" } });
    expect(await sessionRow(first.session.id)).toMatchObject({ ownerToken: TAB_B, activeMs: 4_000, observedMs: 9_000, ownerActiveMs: 0 });
  });

  it("refuses a different kind of session while one is open, and account switches on it", async () => {
    await insertProblem("p1", "p-one", at(24 * HOUR));
    const open = await start({ target: { kind: "problem", problemId: "p1" }, sourceAccount: "alice" });
    const conflict = await startPracticeSession(USER, startInput({ target: { kind: "problem", problemId: "p1" }, mode: "early_review" }), at(MIN));
    expect(conflict).toMatchObject({ ok: false, error: "open_session_conflict", session: { id: open.session.id, type: "voluntary_practice" } });
    const switched = await startPracticeSession(USER, startInput({ target: { kind: "problem", problemId: "p1" }, sourceAccount: "bob" }), at(MIN));
    expect(switched).toMatchObject({ ok: false, error: "account_mismatch" });
  });

  it("releases a stale open session as interrupted history and starts a new one", async () => {
    const old = await start();
    const fresh = await start({}, at(25 * HOUR));
    expect(fresh.created).toBe(true);
    expect(fresh.session.id).not.toBe(old.session.id);
    expect(await sessionRow(old.session.id)).toMatchObject({ isOpen: false, status: "interrupted" });
    const current = await getCurrentPracticeSession(USER, { slug: "two-sum" }, TAB_A, at(25 * HOUR));
    expect(current.session?.id).toBe(fresh.session.id);
  });

  it("requires explicit confirmation before superseding another session's pending rating", async () => {
    await insertProblem("p-due", "due", at(-HOUR));
    const review = await start({ target: { kind: "problem", problemId: "p-due" }, mode: "due_review" });
    await finish(review.session.id, at(10 * MIN));
    const blocked = await startPracticeSession(USER, startInput({ target: { kind: "problem", problemId: "p-due" } }), at(11 * MIN));
    expect(blocked).toMatchObject({ ok: false, error: "rating_pending", session: { id: review.session.id, rating: { disposition: "pending" } } });

    const confirmed = await start({ target: { kind: "problem", problemId: "p-due" }, supersedePendingRating: true }, at(12 * MIN));
    expect(confirmed).toMatchObject({ created: true, supersededSessionIds: [review.session.id] });
    expect((await sessionRow(review.session.id)).ratingDisposition).toBe("superseded");
  });

  it("unarchives the problem it starts on and refreshes LeetCode metadata without touching notes or schedules", async () => {
    await insertProblem("p1", "two-sum", at(24 * HOUR), { leetcodeId: 1, archivedAt: at(-HOUR), notes: "keep", title: "Old" });
    const before = await problemRow("p1");
    const response = await start({ target: { kind: "leetcode", problem: { ...meta("two-sum", 1), title: "Two Sum" } } });
    expect(response).toMatchObject({ unarchived: true, problemCreated: false, problem: { id: "p1", archived: false } });
    const after = await problemRow("p1");
    expect(after).toMatchObject({ title: "Two Sum", notes: "keep", archivedAt: null, fsrsDue: before.fsrsDue, fsrsReps: before.fsrsReps, scheduleRevision: 0 });
  });
});

describe("session commands", () => {
  it("renews the owner's lease with cumulative timing and rejects heartbeats from other tabs", async () => {
    const { session } = await start();
    const beat = (token: string, activeMs: number, observedMs: number, now: Date, availability?: "available" | "signed_out") =>
      command(session.id, { type: "heartbeat", ownerToken: token, activeMs, observedMs, ...(availability ? { availability } : {}) }, now);

    expect(await beat(TAB_A, 20_000, 30_000, at(30_000))).toMatchObject({ ok: true, response: { session: { timing: { activeMs: 20_000, observedMs: 30_000 } } } });
    expect(await beat(TAB_A, 10_000, 15_000, at(31_000))).toMatchObject({ ok: true, response: { session: { timing: { activeMs: 20_000, observedMs: 30_000 } } } });
    expect(await beat(TAB_A, 999_999, 999_999, at(40_000))).toMatchObject({ ok: true, response: { session: { timing: { activeMs: 45_000, observedMs: 45_000 } } } });
    expect(await beat(TAB_B, 1, 1, at(41_000))).toMatchObject({ ok: false, error: "not_owner", session: { ownership: "other_tab" } });
    expect(await beat(TAB_A, 45_000, 45_000, at(42_000), "signed_out")).toMatchObject({ ok: true, response: { session: { capture: { completeness: "partial" } } } });
    expect(await getDb().select().from(schema.practiceSessionCommands)).toHaveLength(1);
  });

  it("lets another tab take over explicitly, after which the old tab can neither heartbeat nor finish", async () => {
    const { session } = await start();
    await command(session.id, { type: "heartbeat", ownerToken: TAB_A, activeMs: 20_000, observedMs: 30_000 }, at(30_000));
    const takeover = await command(session.id, { type: "takeover", requestId: uuid(), ownerToken: TAB_B }, at(35_000));
    expect(takeover).toMatchObject({ ok: true, response: { session: { ownership: "you", timing: { activeMs: 20_000, observedMs: 30_000 } } } });
    expect(await command(session.id, { type: "heartbeat", ownerToken: TAB_A, activeMs: 25_000, observedMs: 36_000 }, at(36_000)))
      .toMatchObject({ ok: false, error: "not_owner" });
    expect(await finish(session.id, at(37_000))).toMatchObject({ ok: false, error: "not_owner" });
    expect(await finish(session.id, at(38_000), { ownerToken: TAB_B })).toMatchObject({ ok: true, response: { session: { status: "completed" } } });
  });

  it("resumes an interrupted session from any tab, but not one another tab still holds", async () => {
    const { session } = await start();
    const resume = () => command(session.id, { type: "resume", requestId: uuid(), ownerToken: TAB_B }, at(10_000));
    expect(await resume()).toMatchObject({ ok: false, error: "not_owner" });
    const current = await getCurrentPracticeSession(USER, { slug: "two-sum" }, TAB_B, at(2 * MIN));
    expect(current.session).toMatchObject({ status: "interrupted", ownership: "none" });
    expect(await command(session.id, { type: "resume", requestId: uuid(), ownerToken: TAB_B }, at(2 * MIN)))
      .toMatchObject({ ok: true, response: { session: { status: "active", ownership: "you" } } });
  });

  it("finishes with an outcome backed by evidence and opens the rating window only for reviews", async () => {
    await insertProblem("p-due", "due", at(-HOUR));
    const review = await start({ target: { kind: "problem", problemId: "p-due" }, mode: "due_review" });
    await observe(review.session.id, [{ leetcodeSubmissionId: "1001", verdict: "Accepted", submittedAt: at(5 * MIN).toISOString() }], at(5 * MIN));
    const done = await finish(review.session.id, at(10 * MIN));
    expect(done).toMatchObject({
      ok: true,
      response: {
        session: {
          status: "completed",
          outcome: "accepted",
          rating: { disposition: "pending", expiresAt: at(10 * MIN + 24 * HOUR).toISOString() },
          timing: { completedAt: at(10 * MIN).toISOString(), completedAtAdjusted: false, wallMs: 10 * MIN },
        },
      },
    });
    expect((await sessionRow(review.session.id)).isOpen).toBe(false);

    const practice = await start({ target: { kind: "leetcode", problem: meta("valid-parentheses", 20) } });
    expect(await finish(practice.session.id, at(MIN))).toMatchObject({ ok: true, response: { session: { outcome: "unknown", rating: { disposition: "not_applicable" } } } });
    const failed = await start({ target: { kind: "leetcode", problem: meta("3sum", 15) } });
    expect(await finish(failed.session.id, at(MIN), { result: "unsuccessful" })).toMatchObject({ ok: true, response: { session: { outcome: "failed" } } });
  });

  it("clamps implausible completion times and marks them adjusted", async () => {
    const future = await start();
    expect(await finish(future.session.id, at(MIN), { occurredAt: at(HOUR).toISOString() }))
      .toMatchObject({ ok: true, response: { session: { timing: { completedAt: at(MIN).toISOString(), completedAtAdjusted: true } } } });
    const past = await start({ target: { kind: "leetcode", problem: meta("3sum", 15) } }, at(2 * MIN));
    expect(await finish(past.session.id, at(3 * MIN), { occurredAt: T0.toISOString() }))
      .toMatchObject({ ok: true, response: { session: { timing: { completedAt: at(2 * MIN).toISOString(), completedAtAdjusted: true } } } });
  });

  it("replays finish, and rejects a second finish or a changed payload", async () => {
    const { session } = await start();
    const input = { type: "finish" as const, requestId: uuid(), ownerToken: TAB_A, result: "solved" as const, occurredAt: at(MIN).toISOString() };
    const first = await command(session.id, input, at(MIN));
    const replay = await command(session.id, input, at(2 * MIN));
    expect(first.ok && replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(replay.response).toEqual({ ...first.response, idempotentReplay: true });
    expect(await command(session.id, { ...input, result: "unsuccessful" }, at(2 * MIN))).toEqual({ ok: false, error: "request_conflict" });
    expect(await finish(session.id, at(3 * MIN))).toMatchObject({ ok: false, error: "invalid_transition" });
  });

  it("abandons without a rating or outcome, and cannot abandon a finished session", async () => {
    await insertProblem("p-due", "due", at(-HOUR));
    const review = await start({ target: { kind: "problem", problemId: "p-due" }, mode: "due_review" });
    const abandoned = await command(review.session.id, { type: "abandon", requestId: uuid(), ownerToken: TAB_A, occurredAt: at(MIN).toISOString() }, at(MIN));
    expect(abandoned).toMatchObject({ ok: true, response: { session: { status: "abandoned", outcome: null, rating: { disposition: "not_applicable" } } } });
    const other = await start();
    await finish(other.session.id, at(MIN));
    expect(await command(other.session.id, { type: "abandon", requestId: uuid(), ownerToken: TAB_A, occurredAt: at(2 * MIN).toISOString() }, at(2 * MIN)))
      .toMatchObject({ ok: false, error: "invalid_transition" });
  });

  it("retires Rate later, skips a pending (or legacy deferred) rating, and reports expiry or supersession instead", async () => {
    await insertProblem("p1", "one", at(-HOUR));
    await insertProblem("p2", "two", at(-HOUR));
    await insertProblem("p3", "three", at(-HOUR));
    const reviewed = async (problemId: string, now = T0) => {
      const { session } = await start({ target: { kind: "problem", problemId }, mode: "due_review" }, now);
      await finish(session.id, new Date(now.getTime() + MIN));
      return session.id;
    };
    const decide = (id: string, type: "defer_rating" | "dismiss_rating", now: Date) => command(id, { type, requestId: uuid() }, now);

    const s1 = await reviewed("p1");
    expect(await decide(s1, "defer_rating", at(2 * MIN))).toMatchObject({ ok: false, error: "rating_defer_retired", session: { rating: { disposition: "pending" } } });
    // A rating deferred before "Rate later" was retired is still pending.
    await getDb().update(schema.practiceSessions).set({ ratingDisposition: "deferred" }).where(eq(schema.practiceSessions.id, s1));
    expect(await decide(s1, "dismiss_rating", at(3 * MIN))).toMatchObject({ ok: true, response: { session: { rating: { disposition: "dismissed" } } } });

    const s2 = await reviewed("p2", at(4 * MIN));
    expect(await decide(s2, "dismiss_rating", at(25 * HOUR))).toMatchObject({ ok: false, error: "rating_not_pending", session: { rating: { disposition: "expired" } } });
    expect((await sessionRow(s2)).ratingDisposition).toBe("expired");

    const s3 = await reviewed("p3", at(26 * HOUR));
    await getDb().update(schema.problems).set({ scheduleRevision: 1 }).where(eq(schema.problems.id, "p3"));
    expect(await decide(s3, "dismiss_rating", at(26 * HOUR + 2 * MIN))).toMatchObject({ ok: false, error: "rating_not_pending", session: { rating: { disposition: "superseded" } } });
  });

  it("starts no formal review while another finished review awaits its rating, until it is rated, skipped, or lapses", async () => {
    await insertProblem("p1", "one", at(-HOUR));
    await insertProblem("p2", "two", at(-HOUR));
    await insertProblem("p3", "three", at(-HOUR));
    const first = await start({ target: { kind: "problem", problemId: "p1" }, mode: "due_review" });
    await finish(first.session.id, at(MIN));

    const blocked = await startPracticeSession(USER, startInput({ target: { kind: "problem", problemId: "p2" }, mode: "due_review" }), at(2 * MIN));
    expect(blocked).toMatchObject({ ok: false, error: "rating_pending", session: { id: first.session.id, rating: { disposition: "pending" } }, problem: { id: "p1", title: "one" } });
    // Superseding is only for the same problem; another one's rating must be given.
    expect(await startPracticeSession(USER, startInput({ target: { kind: "problem", problemId: "p2" }, mode: "due_review", supersedePendingRating: true }), at(2 * MIN)))
      .toMatchObject({ ok: false, error: "rating_pending" });
    expect(await getDb().select().from(schema.practiceSessions).where(eq(schema.practiceSessions.problemId, "p2"))).toEqual([]);
    // Practice that is not a review is never held up.
    const practice = await start({ target: { kind: "leetcode", problem: meta("fresh", 77) }, mode: "practice" }, at(2 * MIN));
    expect(practice.session.type).toBe("initial_learning");

    await command(first.session.id, { type: "dismiss_rating", requestId: uuid() }, at(3 * MIN));
    const second = await start({ target: { kind: "problem", problemId: "p2" }, mode: "due_review" }, at(4 * MIN));
    await finish(second.session.id, at(5 * MIN));
    // Lapsed after the rating window: no longer blocks, and the schedule never moved.
    const third = await start({ target: { kind: "problem", problemId: "p3" }, mode: "due_review" }, at(5 * MIN + 24 * HOUR + 1));
    expect(third.session.type).toBe("scheduled_review");
    expect(await problemRow("p2")).toMatchObject({ scheduleRevision: 0, fsrsDue: at(-HOUR) });
  });

  it("reports the latest session completed in the last week, never an abandoned one", async () => {
    const current = async (now: Date) => (await getCurrentPracticeSession(USER, { slug: "two-sum" }, null, now)).recentCompleted?.id ?? null;
    const first = await start();
    expect(await current(at(MIN))).toBeNull();
    await finish(first.session.id, at(MIN));
    expect(await current(at(2 * MIN))).toBe(first.session.id);
    const abandoned = await start({}, at(3 * MIN));
    await command(abandoned.session.id, { type: "abandon", requestId: uuid(), ownerToken: TAB_A, occurredAt: at(4 * MIN).toISOString() }, at(4 * MIN));
    expect(await current(at(5 * MIN))).toBe(first.session.id);
    const second = await start({}, at(6 * MIN));
    await finish(second.session.id, at(7 * MIN));
    expect(await current(at(8 * MIN))).toBe(second.session.id);
    expect(await current(at(7 * MIN + 7 * 24 * HOUR + 1))).toBeNull();
  });

  it("sets the baseline once when the session started before the page opened", async () => {
    await insertProblem("p1", "one", at(-HOUR));
    const { session } = await start({ target: { kind: "problem", problemId: "p1" }, mode: "due_review", baseline: undefined });
    expect(session.capture.baselineState).toBe("pending");
    const set = (leetcodeSubmissionId: string) =>
      command(session.id, { type: "set_baseline", requestId: uuid(), ownerToken: TAB_A, baseline: { state: "established", leetcodeSubmissionId } }, at(5_000));
    expect(await set("500")).toMatchObject({ ok: true, response: { session: { capture: { baselineState: "established" } } } });
    expect(await set("501")).toMatchObject({ ok: false, error: "baseline_already_set" });
  });

  it("refreshes a problem from the page's metadata when the baseline is set, and ignores another problem's", async () => {
    await insertProblem("p1", "one", at(-HOUR));
    const { session } = await start({ target: { kind: "problem", problemId: "p1" }, mode: "due_review", baseline: undefined });
    const pageMeta = { ...meta("one", 1), title: "One", descriptionMd: "<p>One</p>", similarSlugs: ["two"], similarQuestions: [{ slug: "two", title: "Two", difficulty: "Easy" as const, paidOnly: false }] };
    const set = (problem: typeof pageMeta) =>
      command(session.id, { type: "set_baseline", requestId: uuid(), ownerToken: TAB_A, baseline: { state: "none" }, problem }, at(5_000));
    expect(await set({ ...pageMeta, leetcodeSlug: "other", title: "Other" })).toMatchObject({ ok: true });
    expect(await problemRow("p1")).toMatchObject({ title: "one", descriptionMd: null, similarSlugs: [] });

    const { session: next } = await (async () => {
      await command(session.id, { type: "abandon", requestId: uuid(), ownerToken: TAB_A, occurredAt: at(6_000).toISOString() }, at(6_000));
      return start({ target: { kind: "problem", problemId: "p1" }, mode: "due_review", baseline: undefined }, at(7_000));
    })();
    expect(await command(next.id, { type: "set_baseline", requestId: uuid(), ownerToken: TAB_A, baseline: { state: "none" }, problem: pageMeta }, at(8_000))).toMatchObject({ ok: true });
    expect(await problemRow("p1")).toMatchObject({ title: "One", descriptionMd: "<p>One</p>", similarSlugs: ["two"], fsrsDue: at(-HOUR) });
    expect(await getDb().select({ slug: schema.suggestionCandidates.slug }).from(schema.suggestionCandidates)).toEqual([{ slug: "two" }]);
  });

  it("hides other users' sessions from every command and query", async () => {
    const { session } = await start();
    expect(await command(session.id, { type: "heartbeat", ownerToken: TAB_A, activeMs: 0, observedMs: 0 }, at(1_000), OTHER))
      .toEqual({ ok: false, error: "session_not_found" });
    expect(await finish(session.id, at(1_000)).then(() => runSessionCommand(OTHER, session.id, { type: "defer_rating", requestId: uuid() }, at(2_000))))
      .toEqual({ ok: false, error: "session_not_found" });
    expect(await ingestSessionObservations(OTHER, session.id, { observations: [{ leetcodeSubmissionId: "1", verdict: "Accepted" }] }, at(3_000)))
      .toEqual({ ok: false, error: "session_not_found" });
    expect(await getPracticeSessionDetail(OTHER, session.id, null, at(3_000))).toBeNull();
    expect(await getCurrentPracticeSession(OTHER, { slug: "two-sum" }, null, at(3_000))).toEqual({ problem: null, session: null, pendingRating: null, recentCompleted: null });
    expect((await listPracticeSessions(OTHER, { limit: 20 })).sessions).toEqual([]);
  });
});

describe("session observations", () => {
  it("records in-session submissions with details, keeping identical code under different ids distinct", async () => {
    const { session, problem } = await start();
    const response = await observe(session.id, [
      { leetcodeSubmissionId: "1001", verdict: "Wrong Answer", submittedAt: at(MIN).toISOString(), detail: { language: "python3", code: "return x" } },
      { leetcodeSubmissionId: "1002", verdict: "Accepted", submittedAt: at(2 * MIN).toISOString(), detail: { language: "python3", code: "return x" } },
      { leetcodeSubmissionId: "1002", verdict: "Accepted", submittedAt: at(2 * MIN).toISOString() },
    ], at(2 * MIN));
    expect(response.results.map((result) => result.outcome)).toEqual(["recorded", "recorded", "duplicate"]);
    expect(response.results[2]!.observationId).toBe(response.results[1]!.observationId);
    expect(response.session.evidence).toEqual({
      submissions: 2, accepted: 1, failed: 1, pendingDetails: 0, ambiguous: 0, firstAcceptedAt: at(2 * MIN).toISOString(),
    });
    const stored = await getDb().select().from(schema.submissions).where(eq(schema.submissions.problemId, problem.id));
    expect(stored.map((row) => row.leetcodeSubmissionId).sort()).toEqual(["1001", "1002"]);
  });

  it("records observations without details and enriches them when details arrive", async () => {
    const { session } = await start();
    const bare = { leetcodeSubmissionId: "1003", verdict: "Wrong Answer" as const, submittedAt: at(MIN).toISOString() };
    const first = await observe(session.id, [bare], at(MIN));
    expect(first.results[0]!.outcome).toBe("recorded_pending_detail");
    expect(first.session).toMatchObject({ evidence: { pendingDetails: 1 }, capture: { completeness: "partial" } });
    const enriched = await observe(session.id, [{ ...bare, detail: { language: "python3", code: "pass", failedTestcase: "[1]" } }], at(2 * MIN));
    expect(enriched.results[0]).toMatchObject({ outcome: "enriched", observationId: first.results[0]!.observationId });
    expect(enriched.session).toMatchObject({ evidence: { pendingDetails: 0 }, capture: { completeness: "complete" } });
    expect((await observe(session.id, [bare], at(3 * MIN))).results[0]!.outcome).toBe("duplicate");

    const other = await observe(session.id, [{ leetcodeSubmissionId: "1004", verdict: "Runtime Error", submittedAt: at(3 * MIN).toISOString() }], at(3 * MIN));
    await observe(session.id, [{ leetcodeSubmissionId: "1004", verdict: "Runtime Error", detailUnavailable: true }], at(4 * MIN));
    const detail = await getPracticeSessionDetail(USER, session.id, TAB_A, at(4 * MIN));
    expect(detail!.observations.find((row) => row.id === other.results[0]!.observationId)).toMatchObject({ detailStatus: "unavailable" });
  });

  it("leaves historical submissions unassigned and keeps boundary cases ambiguous", async () => {
    const { session } = await start({ baseline: undefined });
    const response = await observe(session.id, [
      { leetcodeSubmissionId: "900", verdict: "Accepted", submittedAt: at(-HOUR).toISOString() },
      { leetcodeSubmissionId: "1005", verdict: "Wrong Answer", submittedAt: at(-10_000).toISOString() },
    ], at(MIN));
    expect(response.results.map((result) => result.outcome)).toEqual(["outside_session", "ambiguous"]);
    expect(response.session.evidence).toMatchObject({ submissions: 0, ambiguous: 1 });
    const observations = await getDb().select().from(schema.practiceSessionSubmissions);
    expect(observations).toMatchObject([{ leetcodeSubmissionId: "1005", association: "ambiguous" }]);
  });

  it("links details stored by an earlier capture, and never associates one submission twice", async () => {
    const captured = await captureProblem(USER, {
      ...meta("two-sum", 1),
      submissions: [{ leetcodeSubmissionId: "1006", language: "python3", code: "pass", status: "Accepted", submittedAt: at(MIN).toISOString() }],
    });
    if ("error" in captured) throw new Error(captured.error);
    const first = await start();
    const linked = await observe(first.session.id, [{ leetcodeSubmissionId: "1006", verdict: "Accepted", submittedAt: at(MIN).toISOString() }], at(2 * MIN));
    expect(linked.results[0]!.outcome).toBe("recorded");

    const second = await start({ target: { kind: "leetcode", problem: meta("3sum", 15) } });
    const conflict = await observe(second.session.id, [
      { leetcodeSubmissionId: "1006", verdict: "Accepted", submittedAt: at(2 * MIN).toISOString() },
      { leetcodeSubmissionId: "1007", verdict: "Accepted", submittedAt: at(2 * MIN).toISOString() },
    ], at(3 * MIN));
    expect(conflict.results.map((result) => result.outcome)).toEqual(["conflict", "recorded_pending_detail"]);
  });

  it("records the observation but reports details blocked by the per-problem cap", async () => {
    const { session, problem } = await start();
    await getDb().insert(schema.submissions).values(Array.from({ length: MAX_SUBMISSIONS_PER_PROBLEM }, (_, index) => ({
      id: `filler-${index}`, userId: USER, problemId: problem.id, leetcodeSubmissionId: `9${index}`,
      language: "python3", code: `filler ${index}`, status: "Wrong Answer" as const,
    })));
    const response = await observe(session.id, [
      { leetcodeSubmissionId: "2001", verdict: "Accepted", submittedAt: at(MIN).toISOString(), detail: { language: "python3", code: "pass" } },
    ], at(MIN));
    expect(response.results[0]!.outcome).toBe("capacity_blocked");
    expect(response.session.evidence).toMatchObject({ submissions: 1, accepted: 1, pendingDetails: 1 });
  });

  it("accepts late observations judged within the grace period after Finish", async () => {
    const { session } = await start();
    await finish(session.id, at(10 * MIN));
    const response = await observe(session.id, [
      { leetcodeSubmissionId: "3001", verdict: "Accepted", submittedAt: at(10 * MIN + 30_000).toISOString() },
      { leetcodeSubmissionId: "3002", verdict: "Accepted", submittedAt: at(12 * MIN).toISOString() },
    ], at(HOUR));
    expect(response.results.map((result) => result.outcome)).toEqual(["recorded_pending_detail", "outside_session"]);
    expect(response.session.timing.lastActivityAt).toBe(at(10 * MIN).toISOString());
  });
});

describe("scheduling isolation and history", () => {
  it("never changes FSRS state or the schedule revision through any session operation", async () => {
    await insertProblem("p-due", "due", at(-HOUR));
    const before = await problemRow("p-due");
    const review = await start({ target: { kind: "problem", problemId: "p-due" }, mode: "due_review" });
    await command(review.session.id, { type: "heartbeat", ownerToken: TAB_A, activeMs: 1_000, observedMs: 2_000 }, at(10_000));
    await observe(review.session.id, [{ leetcodeSubmissionId: "1001", verdict: "Accepted", submittedAt: at(MIN).toISOString(), detail: { language: "python3", code: "pass" } }], at(MIN));
    await finish(review.session.id, at(2 * MIN));
    await command(review.session.id, { type: "defer_rating", requestId: uuid() }, at(3 * MIN));
    await command(review.session.id, { type: "dismiss_rating", requestId: uuid() }, at(4 * MIN));
    const after = await problemRow("p-due");
    const scheduling = (row: typeof before) => ({
      fsrsDue: row.fsrsDue, fsrsStability: row.fsrsStability, fsrsDifficulty: row.fsrsDifficulty, fsrsElapsedDays: row.fsrsElapsedDays,
      fsrsScheduledDays: row.fsrsScheduledDays, fsrsLearningSteps: row.fsrsLearningSteps, fsrsReps: row.fsrsReps, fsrsLapses: row.fsrsLapses,
      fsrsState: row.fsrsState, fsrsLastReview: row.fsrsLastReview, scheduleRevision: row.scheduleRevision, enrollment: row.enrollment,
    });
    expect(scheduling(after)).toEqual(scheduling(before));
    const events = await getDb().select().from(schema.reviewEvents).where(eq(schema.reviewEvents.problemId, "p-due"));
    expect(events.map((event) => event.eventType)).toEqual(["submission_imported"]);
  });

  it("supersedes a pending session rating when the legacy route reschedules the problem", async () => {
    await insertProblem("p-due", "due", at(-HOUR));
    const review = await start({ target: { kind: "problem", problemId: "p-due" }, mode: "due_review" });
    await finish(review.session.id, at(MIN));
    await rateProblemReview(USER, { problemId: "p-due", rating: 3, requestId: uuid() });
    const current = await getCurrentPracticeSession(USER, { problemId: "p-due" }, null, at(2 * MIN));
    expect(current.pendingRating).toBeNull();
  });

  it("paginates history newest first", async () => {
    for (const [index, slug] of ["a", "b", "c"].entries()) await start({ target: { kind: "leetcode", problem: meta(slug, index + 10) } }, at(index * MIN));
    const page = await listPracticeSessions(USER, { limit: 2 }, at(HOUR));
    expect(page.sessions.map((session) => session.timing.startedAt)).toEqual([at(2 * MIN).toISOString(), at(MIN).toISOString()]);
    const rest = await listPracticeSessions(USER, { limit: 2, cursor: page.nextCursor! }, at(HOUR));
    expect(rest).toMatchObject({ nextCursor: null, sessions: [{ timing: { startedAt: T0.toISOString() } }] });
  });

  it("exports sessions and observations without owner tokens", async () => {
    const { session } = await start();
    await observe(session.id, [{ leetcodeSubmissionId: "1001", verdict: "Accepted", submittedAt: at(MIN).toISOString() }], at(MIN));
    await start({}, T0, OTHER);
    const records: { type: string; data: Record<string, unknown> }[] = [];
    for await (const record of iterateAccountExport({ id: USER, name: "Owner", email: "sessions@example.test", image: null })) {
      records.push(record as { type: string; data: Record<string, unknown> });
    }
    const sessions = records.filter((record) => record.type === "practice_session");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.data).toMatchObject({ id: session.id, userId: USER, type: "initial_learning" });
    expect(sessions[0]!.data).not.toHaveProperty("ownerToken");
    expect(records.filter((record) => record.type === "practice_session_submission")).toMatchObject([{ data: { leetcodeSubmissionId: "1001" } }]);
  });
});
