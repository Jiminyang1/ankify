import { afterAll, beforeAll, expect, it } from "vitest";
import { getDb, schema } from "@ankify/db";
import { ingestSessionObservations, runSessionCommand, startPracticeSession } from "./practice-sessions/commands";
import { rateProblemReview } from "./review-commands";
import { loadReviewOverview } from "./review-overview";
import { setReviewSettings } from "./settings";
import { createTestDb } from "./test-db";
import { getZonedDayBounds } from "./time-zone";

const testDb = createTestDb();
const USER = "overview-owner";
const OTHER = "overview-other";
const TAB = "aaaaaaaa-0000-4000-8000-00000000000a";
const DAY = 86_400_000;
const now = new Date();
const { start: startOfToday } = getZonedDayBounds("UTC", now);

async function problem(id: string, fsrsDue: Date | null, extra: Partial<typeof schema.problems.$inferInsert> = {}) {
  await getDb().insert(schema.problems).values({
    id, userId: USER, leetcodeSlug: id, title: id, difficulty: "Medium", url: `https://leetcode.com/problems/${id}/`,
    fsrsState: "review", fsrsReps: 2, fsrsStability: 5, fsrsDifficulty: 5, fsrsLastReview: new Date(now.getTime() - 10 * DAY),
    fsrsDue, ...extra,
  });
}

async function command(sessionId: string, type: "finish", at: Date) {
  const result = await runSessionCommand(USER, sessionId, { type, requestId: crypto.randomUUID(), ownerToken: TAB, result: "solved", occurredAt: at.toISOString() }, at);
  if (!result.ok) throw new Error(result.error);
}

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values([
    { id: USER, name: "Owner", email: "overview@example.test" },
    { id: OTHER, name: "Other", email: "overview-other@example.test" },
  ]);
  await setReviewSettings(USER, { timeZone: "UTC", dailyReviewLimit: 2 });
  await problem("overdue", new Date(startOfToday.getTime() - 2 * DAY));
  await problem("to-rate", new Date(startOfToday.getTime() - DAY));
  await problem("today", startOfToday);
  await problem("upcoming", new Date(now.getTime() + 2 * DAY));
  await problem("far", new Date(now.getTime() + 10 * DAY));
  await problem("awaiting", null, { enrollment: "awaiting_initial", fsrsState: "new", fsrsReps: 0, fsrsLastReview: null });
  await problem("archived", new Date(now.getTime() - DAY), { archivedAt: new Date(now.getTime() - DAY) });
  await getDb().insert(schema.problems).values({
    id: "other-due", userId: OTHER, leetcodeSlug: "x", title: "x", difficulty: "Easy", url: "https://leetcode.com/problems/x/",
    fsrsDue: new Date(now.getTime() - DAY),
  });

  // A due review completed a few minutes ago, awaiting its rating.
  const review = await startPracticeSession(USER, { requestId: crypto.randomUUID(), target: { kind: "problem", problemId: "to-rate" }, mode: "due_review", ownerToken: TAB, supersedePendingRating: false }, new Date(now.getTime() - 10 * 60_000));
  if (!review.ok) throw new Error(review.error);
  await ingestSessionObservations(USER, review.response.session.id, { observations: [{ leetcodeSubmissionId: "11", verdict: "Accepted", submittedAt: new Date(now.getTime() - 8 * 60_000).toISOString() }] }, new Date(now.getTime() - 8 * 60_000));
  await command(review.response.session.id, "finish", new Date(now.getTime() - 5 * 60_000));
  // Initial learning completed today on a problem new to Ankify.
  const initial = await startPracticeSession(USER, {
    requestId: crypto.randomUUID(), mode: "practice", ownerToken: TAB, supersedePendingRating: false, baseline: { state: "none" },
    target: { kind: "leetcode", problem: { leetcodeSlug: "fresh", leetcodeId: 999, title: "Fresh", difficulty: "Easy", url: "https://leetcode.com/problems/fresh/", topicTags: [], similarSlugs: [] } },
  }, new Date(now.getTime() - 4 * 60_000));
  if (!initial.ok) throw new Error(initial.error);
  await command(initial.response.session.id, "finish", new Date(now.getTime() - 3 * 60_000));
  // A voluntary session still open on a problem that is not due.
  const open = await startPracticeSession(USER, { requestId: crypto.randomUUID(), target: { kind: "problem", problemId: "upcoming" }, mode: "practice", ownerToken: TAB, supersedePendingRating: false }, new Date(now.getTime() - 30_000));
  if (!open.ok) throw new Error(open.error);
  // A legacy rating today (on an archived problem, so it stays out of the lists).
  await rateProblemReview(USER, { problemId: "archived", rating: 3, requestId: crypto.randomUUID() });
});
afterAll(() => testDb.cleanup());

it("lists due problems most overdue first within the daily limit, with uncapped counts", async () => {
  const overview = await loadReviewOverview(USER, 20, now);
  expect(overview.timeZone).toBe("UTC");
  expect(overview.queue).toMatchObject({ dailyReviewLimit: 2, doneToday: 1, remaining: 1 });
  expect(overview.due.map((item) => [item.id, item.overdueDays])).toEqual([["overdue", 2]]);
  expect(overview.counts).toMatchObject({ dueNow: 3, overdue: 2, awaitingInitial: 1 });
  expect(overview.due.map((item) => item.id)).not.toContain("awaiting");
});

it("shows what comes next and which sessions can be resumed or rated", async () => {
  const overview = await loadReviewOverview(USER, 20, now);
  const upcoming = overview.upcoming.map((item) => item.id);
  expect(upcoming).toContain("upcoming");
  expect(upcoming).not.toContain("far");
  expect(overview.upcoming.find((item) => item.id === "upcoming")!.openSessionId).toBe(overview.openSessions[0]!.session.id);
  expect(overview.openSessions).toMatchObject([{ problem: { id: "upcoming" }, session: { type: "voluntary_practice", status: "active" } }]);
  expect(overview.pendingRatings).toMatchObject([
    { problem: { id: "to-rate", due: true }, session: { type: "scheduled_review", outcome: "accepted", rating: { disposition: "pending" } } },
  ]);
});

it("counts reviews, initial learning, and completed sessions separately", async () => {
  const overview = await loadReviewOverview(USER, 20, now);
  expect(overview.counts).toMatchObject({ reviewsToday: 1, initialLearningToday: 1, sessionsCompletedToday: 2 });
  // The initialized problem is scheduled a day out, not awaiting anything.
  expect(overview.upcoming.map((item) => item.leetcodeSlug)).toContain("fresh");
});

it("returns nothing from other users", async () => {
  const overview = await loadReviewOverview(OTHER, 20, now);
  expect(overview.counts).toMatchObject({ dueNow: 1, reviewsToday: 0, initialLearningToday: 0, sessionsCompletedToday: 0 });
  expect(overview.pendingRatings).toEqual([]);
  expect(overview.openSessions).toEqual([]);
});
