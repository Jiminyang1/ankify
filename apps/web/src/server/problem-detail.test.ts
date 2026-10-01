import { afterAll, beforeAll, expect, it } from "vitest";
import { getDb, schema } from "@ankify/db";
import { runSessionCommand, startPracticeSession } from "./practice-sessions/commands";
import { ratePracticeSession } from "./practice-sessions/scheduling";
import { loadProblemDetail } from "./problem-detail";
import { undoLatestProblemReview } from "./review-commands";
import { createTestDb } from "./test-db";

const testDb = createTestDb();
const USER = "detail-user";
const OTHER = "detail-other";
const TAB = "aaaaaaaa-0000-4000-8000-00000000000a";
const MIN = 60_000;
const DAY = 86_400_000;
const T0 = new Date(Date.now() - 10 * DAY);
const at = (ms: number) => new Date(T0.getTime() + ms);
const uuid = () => crypto.randomUUID();

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values([
    { id: USER, name: "Owner", email: "detail@example.test" },
    { id: OTHER, name: "Other", email: "detail-other@example.test" },
  ]);
});
afterAll(() => testDb.cleanup());

it("shows the problem's sessions and scheduling timeline, without undone ratings", async () => {
  // First practice, scheduled for its first review a day later.
  const first = await startPracticeSession(USER, {
    requestId: uuid(), ownerToken: TAB, mode: "practice", baseline: { state: "none" }, supersedePendingRating: false,
    target: { kind: "leetcode", problem: { leetcodeSlug: "two-sum", title: "Two Sum", difficulty: "Easy", url: "https://leetcode.com/problems/two-sum/", topicTags: [], similarSlugs: [] } },
  }, T0);
  if (!first.ok) throw new Error(first.error);
  const problemId = first.response.problem.id;
  await runSessionCommand(USER, first.response.session.id, { type: "finish", requestId: uuid(), ownerToken: TAB, result: "solved", occurredAt: at(MIN).toISOString() }, at(MIN));

  // Two reviews: the first rating stays, the second is undone.
  const review = async (startAt: Date, rating: 1 | 3) => {
    const started = await startPracticeSession(USER, { requestId: uuid(), ownerToken: TAB, mode: "due_review", target: { kind: "problem", problemId }, supersedePendingRating: false }, startAt);
    if (!started.ok) throw new Error(started.error);
    const finishedAt = new Date(startAt.getTime() + MIN);
    await runSessionCommand(USER, started.response.session.id, { type: "finish", requestId: uuid(), ownerToken: TAB, result: "solved", occurredAt: finishedAt.toISOString() }, finishedAt);
    const rated = await ratePracticeSession(USER, started.response.session.id, { requestId: uuid(), rating }, new Date(finishedAt.getTime() + MIN));
    if (!rated.ok) throw new Error(rated.error);
    return { sessionId: started.response.session.id, nextDue: rated.response.nextDue };
  };
  const kept = await review(at(DAY + MIN), 3);
  const nextReviewAt = new Date(Date.parse(kept.nextDue!) + MIN);
  await review(nextReviewAt, 1);
  await undoLatestProblemReview(USER, { problemId });

  const detail = (await loadProblemDetail(USER, problemId))!;
  expect(detail.timeline.map(({ kind, rating, method, nextDue }) => ({ kind, rating, method, hasDue: nextDue != null }))).toEqual([
    { kind: "rated", rating: 3, method: "leetcode_full_solve", hasDue: true },
    { kind: "scheduled", rating: null, method: "leetcode_full_solve", hasDue: true },
  ]);
  expect(detail.timeline[0]!.nextDue).toBe(kept.nextDue);
  expect(detail.timeline[0]!.practiceSessionId).toBe(kept.sessionId);
  expect(detail.sessions.map((session) => session.type)).toEqual(["scheduled_review", "scheduled_review", "initial_learning"]);
  expect(await loadProblemDetail(OTHER, problemId)).toBeNull();
});
