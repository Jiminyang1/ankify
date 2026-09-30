import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SuggestionDto } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { and, eq } from "drizzle-orm";
import { iterateAccountExport } from "../account-export";
import { createMistake } from "../mistakes";
import { ingestSessionObservations, runSessionCommand, startPracticeSession } from "../practice-sessions/commands";
import { loadMistakeProfile } from "../mistake-profile";
import { upsertLeetcodeProblem } from "../problem-upsert";
import { setReviewSettings } from "../settings";
import { createTestDb } from "../test-db";
import { actOnSuggestion, allocateSuggestion, listSuggestions, MAX_SUGGESTIONS_PER_DAY } from "./commands";
import { mergeAttemptHistory } from "./history";

const testDb = createTestDb();
const USER = "suggest-user";
const OTHER = "suggest-other";
const TAB = "aaaaaaaa-0000-4000-8000-00000000000a";
const MIN = 60_000;
const DAY = 86_400_000;
const T0 = new Date(Date.now() - 2 * DAY);
const at = (ms: number) => new Date(T0.getTime() + ms);
const uuid = () => crypto.randomUUID();

const similar = (slug: string, difficulty: "Easy" | "Medium" | "Hard" = "Medium", paidOnly = false) => ({ slug, title: `Title ${slug}`, difficulty, paidOnly });
const meta = (slug: string, similarQuestions: ReturnType<typeof similar>[] = [], topics = ["Array"]) => ({
  leetcodeSlug: slug,
  title: `Title ${slug}`,
  difficulty: "Medium" as const,
  url: `https://leetcode.com/problems/${slug}/`,
  topicTags: topics,
  similarSlugs: similarQuestions.map((question) => question.slug),
  similarQuestions,
});

/** A captured problem whose similar questions become candidates. */
async function captured(slug: string, similarSlugs: string[], userId = USER, now = T0) {
  const result = await getDb().transaction((tx) =>
    upsertLeetcodeProblem(tx, userId, meta(slug, similarSlugs.map((candidate) => similar(candidate))), { enrollment: "enrolled", now }),
  );
  if (!result.ok) throw new Error(result.error);
  return result.problem;
}

async function daily(now = T0, userId = USER, requestId = uuid()) {
  const result = await allocateSuggestion(userId, { requestId, kind: "daily" }, now);
  if (!result.ok) throw new Error(result.error);
  return result.response;
}
async function extra(now = T0, requestId = uuid()) {
  const result = await allocateSuggestion(USER, { requestId, kind: "extra" }, now);
  if (!result.ok) throw new Error(result.error);
  return result.response;
}
const suggestionOf = (response: Awaited<ReturnType<typeof daily>>): SuggestionDto => {
  if (!response.suggestion) throw new Error("no suggestion");
  return response.suggestion;
};

beforeAll(() => testDb.migrate());
beforeEach(async () => {
  await getDb().delete(schema.user);
  await getDb().insert(schema.user).values([
    { id: USER, name: "Owner", email: "suggest@example.test" },
    { id: OTHER, name: "Other", email: "suggest-other@example.test" },
  ]);
});
afterAll(() => testDb.cleanup());

describe("allocating suggestions", () => {
  it("allocates one daily suggestion per local day and freezes it across refreshes", async () => {
    await captured("two-sum", ["3sum", "4sum"]);
    const first = suggestionOf(await daily());
    expect(first).toMatchObject({
      ordinal: 0,
      kind: "daily",
      status: "pending",
      lane: "general",
      novelty: "unverified",
      category: null,
      plannerVersion: "suggestions-v1",
      reasons: [{ code: "general_practice", why: "not_personalized" }, { code: "similar_to", title: "Title two-sum", category: null }],
      target: { url: `https://leetcode.com/problems/${first.target.slug}/` },
    });
    expect(["3sum", "4sum"]).toContain(first.target.slug);

    // More candidates, another request: still the same, frozen suggestion.
    await captured("valid-anagram", ["group-anagrams"]);
    expect(await daily(at(MIN))).toEqual({ suggestion: first, idempotentReplay: true });
    expect((await listSuggestions(USER, at(MIN))).suggestions).toEqual([first]);

    // The next day gets a new one; yesterday's is still pending, so it is not repeated.
    const next = suggestionOf(await daily(at(DAY)));
    expect(next.id).not.toBe(first.id);
    expect(next.target.slug).not.toBe(first.target.slug);
    expect(next.dateKey).not.toBe(first.dateKey);
  });

  it("adds extras with distinct targets, replays by request id, and stores nothing when none is eligible", async () => {
    await captured("two-sum", ["3sum", "4sum", "3sum-closest"]);
    const first = suggestionOf(await daily());
    const requestId = uuid();
    const second = suggestionOf(await extra(T0, requestId));
    expect(second).toMatchObject({ ordinal: 1, kind: "extra" });
    expect(await extra(T0, requestId)).toEqual({ suggestion: second, idempotentReplay: true });
    expect(await allocateSuggestion(USER, { requestId, kind: "daily" }, T0)).toEqual({ ok: false, error: "request_conflict" });
    const third = suggestionOf(await extra());
    expect(new Set([first.target.slug, second.target.slug, third.target.slug]).size).toBe(3);
    expect(await extra()).toEqual({ suggestion: null, reason: "no_candidates" });
    expect(await getDb().select().from(schema.suggestions)).toHaveLength(3);
  });

  it("rolls the daily suggestion over at local midnight in the user's time zone", async () => {
    await captured("two-sum", ["3sum", "4sum"]);
    await setReviewSettings(USER, { timeZone: "America/Los_Angeles" });
    // 06:00 UTC is still the previous evening in Los Angeles; 08:00 UTC is the next day.
    const evening = new Date("2026-10-01T06:00:00.000Z");
    const morning = new Date("2026-10-01T08:00:00.000Z");
    const before = suggestionOf(await daily(evening));
    expect(before.dateKey).toBe("2026-09-30");
    expect(await daily(new Date("2026-10-01T06:59:00.000Z"))).toEqual({ suggestion: before, idempotentReplay: true });
    const after = suggestionOf(await daily(morning));
    expect(after).toMatchObject({ dateKey: "2026-10-01", ordinal: 0 });
    expect(after.id).not.toBe(before.id);
  });

  it("stops at the daily cap", async () => {
    await captured("two-sum", ["3sum"]);
    const { dateKey } = await listSuggestions(USER, T0);
    await getDb().insert(schema.suggestions).values(
      Array.from({ length: MAX_SUGGESTIONS_PER_DAY }, (_, ordinal) => ({
        id: `filled-${ordinal}`, userId: USER, dateKey, ordinal, kind: "extra" as const, slug: `filled-${ordinal}`, title: "Filled", difficulty: "Easy" as const,
        lane: "general" as const, reasons: [], plannerVersion: "suggestions-v1", verifiedAt: T0, novelty: "unverified" as const, status: "skipped" as const, requestId: uuid(),
      })),
    );
    expect(await allocateSuggestion(USER, { requestId: uuid(), kind: "extra" }, T0)).toEqual({ ok: false, error: "suggestion_limit_reached" });
  });

  it("never suggests a problem that is captured, attempted, deleted, or paid", async () => {
    await captured("two-sum", ["3sum", "4sum", "deleted-one", "premium"]);
    await getDb().update(schema.suggestionCandidates).set({ paidOnly: true }).where(eq(schema.suggestionCandidates.slug, "premium"));
    await captured("3sum", []);
    await mergeAttemptHistory(USER, { source: "leetcode_status", sourceAccount: "leet_user", entries: [{ slug: "4sum", status: "attempted" }] }, T0);
    await getDb().insert(schema.attemptHistory).values({ id: "deleted", userId: USER, slug: "deleted-one", status: "attempted", source: "deleted_problem", observedAt: T0 });
    expect(await daily()).toEqual({ suggestion: null, reason: "no_candidates" });
    expect(await getDb().select().from(schema.suggestions)).toEqual([]);
  });

  it("says no prior attempt was found only after both LeetCode lists were read to the end recently", async () => {
    await captured("two-sum", ["3sum", "4sum", "3sum-closest"]);
    const read = (scope: "problem_list_accepted" | "problem_list_tried", now: Date) =>
      mergeAttemptHistory(USER, { source: "leetcode_status", sourceAccount: "leet_user", entries: [], coverage: { scope, read: 40, total: 40, complete: true } }, now);
    await read("problem_list_accepted", at(-40 * DAY));
    await read("problem_list_tried", T0);
    expect(suggestionOf(await daily()).novelty).toBe("unverified");
    await read("problem_list_accepted", T0);
    expect(suggestionOf(await extra()).novelty).toBe("no_prior_attempt_found");
  });

  it("targets a weak, confirmed dimension once the profile is personalized", async () => {
    const practice = async (slug: string, similarSlugs: string[], topics: string[], offset: number) => {
      const startAt = at(offset);
      const started = await startPracticeSession(USER, {
        requestId: uuid(), ownerToken: TAB, mode: "practice", baseline: { state: "none" }, supersedePendingRating: false,
        target: { kind: "leetcode", problem: meta(slug, similarSlugs.map((candidate) => similar(candidate)), topics) },
      }, startAt);
      if (!started.ok) throw new Error(started.error);
      const { session, problem } = started.response;
      await ingestSessionObservations(USER, session.id, {
        observations: [{ leetcodeSubmissionId: String(8_000 + offset / MIN), verdict: "Wrong Answer", submittedAt: new Date(startAt.getTime() + MIN).toISOString(), detail: { language: "python3", code: "x" } }],
      }, new Date(startAt.getTime() + 2 * MIN));
      await runSessionCommand(USER, session.id, { type: "finish", requestId: uuid(), ownerToken: TAB, result: "unsuccessful", occurredAt: new Date(startAt.getTime() + 3 * MIN).toISOString() }, new Date(startAt.getTime() + 3 * MIN));
      return { sessionId: session.id, problemId: problem.id };
    };
    const first = await practice("coin-change", ["coin-change-ii"], ["Dynamic Programming"], -30 * MIN);
    const second = await practice("house-robber", ["house-robber-ii"], ["Dynamic Programming"], -20 * MIN);
    await practice("number-of-islands", ["max-area-of-island"], ["Graph"], -10 * MIN);
    for (const { sessionId, problemId } of [first, second]) {
      const created = await createMistake(USER, { sourceType: "practice_session", practiceSessionId: sessionId, problemId, primaryCategory: "invariant", requestId: uuid() });
      if (!created.ok) throw new Error(created.error);
    }
    const suggestion = suggestionOf(await daily());
    expect(suggestion).toMatchObject({
      lane: "personalized",
      category: "invariant",
      reasons: [{ code: "category_focus", category: "invariant", contexts: 2 }, { code: "similar_to", category: "invariant" }],
    });
    expect(["coin-change-ii", "house-robber-ii"]).toContain(suggestion.target.slug);
  });
});

describe("acting on suggestions", () => {
  it("skips with a replacement stored in the same transaction, once", async () => {
    await captured("two-sum", ["3sum", "4sum"]);
    const first = suggestionOf(await daily());
    const requestId = uuid();
    const skipped = await actOnSuggestion(USER, first.id, { action: "skip", requestId }, at(MIN));
    if (!skipped.ok) throw new Error(skipped.error);
    expect(skipped.response).toMatchObject({
      suggestion: { id: first.id, status: "skipped" },
      replacement: { kind: "replacement", replacesId: first.id, ordinal: 1, status: "pending" },
      session: null,
      idempotentReplay: false,
    });
    expect(skipped.response.replacement!.target.slug).not.toBe(first.target.slug);
    expect(await actOnSuggestion(USER, first.id, { action: "skip", requestId }, at(2 * MIN))).toEqual({ ok: true, response: { ...skipped.response, idempotentReplay: true } });
    expect(await actOnSuggestion(USER, first.id, { action: "already_attempted", requestId }, at(2 * MIN))).toEqual({ ok: false, error: "request_conflict" });
    expect(await actOnSuggestion(USER, first.id, { action: "skip", requestId: uuid() }, at(2 * MIN))).toMatchObject({ ok: false, error: "suggestion_already_handled", suggestion: { status: "skipped" } });
    expect((await listSuggestions(USER, at(3 * MIN))).suggestions.map((item) => item.status)).toEqual(["skipped", "pending"]);
  });

  it("changes no schedule and no weakness when suggestions are skipped or marked attempted", async () => {
    const parent = await captured("two-sum", ["3sum", "4sum", "3sum-closest"]);
    const problems = () => getDb().select().from(schema.problems).where(eq(schema.problems.userId, USER));
    const [problemsBefore, profileBefore] = [await problems(), await loadMistakeProfile(USER, T0)];
    const first = suggestionOf(await daily());
    const skipped = await actOnSuggestion(USER, first.id, { action: "skip", requestId: uuid() }, T0);
    if (!skipped.ok || !skipped.response.replacement) throw new Error("expected a replacement");
    await actOnSuggestion(USER, skipped.response.replacement.id, { action: "already_attempted", requestId: uuid() }, T0);
    expect(await problems()).toEqual(problemsBefore);
    expect({ ...(await loadMistakeProfile(USER, T0)), generatedAt: null }).toEqual({ ...profileBefore, generatedAt: null });
    expect(await getDb().select().from(schema.reviewEvents).where(eq(schema.reviewEvents.problemId, parent.id))).toHaveLength(1);
  });

  it("excludes a problem marked already attempted for good", async () => {
    await captured("two-sum", ["3sum", "4sum"]);
    const first = suggestionOf(await daily());
    const marked = await actOnSuggestion(USER, first.id, { action: "already_attempted", requestId: uuid() }, T0);
    if (!marked.ok || !marked.response.replacement) throw new Error("expected a replacement");
    expect(await getDb().select({ slug: schema.attemptHistory.slug, source: schema.attemptHistory.source }).from(schema.attemptHistory)).toEqual([{ slug: first.target.slug, source: "user_marked" }]);
    // Weeks later, after the replacement was skipped too, only it may return.
    await actOnSuggestion(USER, marked.response.replacement.id, { action: "skip", requestId: uuid() }, T0);
    const later = suggestionOf(await daily(at(40 * DAY)));
    expect(later.target.slug).toBe(marked.response.replacement.target.slug);
  });

  it("starts initial learning on a new problem, links the session, and reports its outcome", async () => {
    await captured("two-sum", ["3sum"]);
    const suggestion = suggestionOf(await daily());
    const requestId = uuid();
    const started = await actOnSuggestion(USER, suggestion.id, { action: "start", requestId, ownerToken: TAB }, at(MIN));
    if (!started.ok) throw new Error(started.error);
    const session = started.response.session!;
    expect(started.response.suggestion).toMatchObject({ status: "started", practiceSessionId: session.session.id, outcome: null });
    expect(session).toMatchObject({ created: true, problemCreated: true, session: { type: "initial_learning", status: "active" } });
    const [problem] = await getDb().select().from(schema.problems).where(and(eq(schema.problems.userId, USER), eq(schema.problems.leetcodeSlug, "3sum")));
    expect(problem).toMatchObject({ title: "Title 3sum", difficulty: "Medium", enrollment: "awaiting_initial", fsrsDue: null });

    const replay = await actOnSuggestion(USER, suggestion.id, { action: "start", requestId, ownerToken: TAB }, at(2 * MIN));
    expect(replay).toMatchObject({ ok: true, response: { idempotentReplay: true, session: { session: { id: session.session.id }, idempotentReplay: true } } });
    expect(await actOnSuggestion(USER, suggestion.id, { action: "start", requestId: uuid(), ownerToken: TAB }, at(2 * MIN))).toMatchObject({ ok: false, error: "suggestion_already_handled" });

    // Finishing follows the normal initial-learning rules.
    await ingestSessionObservations(USER, session.session.id, {
      observations: [{ leetcodeSubmissionId: "9001", verdict: "Accepted", submittedAt: at(3 * MIN).toISOString(), detail: { language: "python3", code: "x" } }],
    }, at(4 * MIN));
    await runSessionCommand(USER, session.session.id, { type: "finish", requestId: uuid(), ownerToken: TAB, result: "solved", occurredAt: at(5 * MIN).toISOString() }, at(5 * MIN));
    expect((await listSuggestions(USER, at(6 * MIN))).suggestions).toMatchObject([{ id: suggestion.id, status: "started", outcome: "accepted" }]);
    const [after] = await getDb().select().from(schema.problems).where(eq(schema.problems.id, problem!.id));
    expect(after).toMatchObject({ enrollment: "enrolled" });
  });

  it("links a suggestion when its problem's practice starts elsewhere, such as the problem page", async () => {
    await captured("two-sum", ["3sum"]);
    const suggestion = suggestionOf(await daily());
    const started = await startPracticeSession(USER, {
      requestId: uuid(), ownerToken: TAB, mode: "practice", baseline: { state: "none" }, supersedePendingRating: false,
      target: { kind: "leetcode", problem: meta("3sum") },
    }, at(MIN));
    if (!started.ok) throw new Error(started.error);
    expect((await listSuggestions(USER, at(2 * MIN))).suggestions).toMatchObject([
      { id: suggestion.id, status: "started", practiceSessionId: started.response.session.id, outcome: null },
    ]);
    expect(await actOnSuggestion(USER, suggestion.id, { action: "skip", requestId: uuid() }, at(2 * MIN))).toMatchObject({ ok: false, error: "suggestion_already_handled" });
  });

  it("starts a problem already in the deck by id, keeping its own metadata", async () => {
    await captured("two-sum", ["3sum"]);
    const suggestion = suggestionOf(await daily());
    const existing = await captured("3sum", ["3sum-closest"], USER, at(MIN));
    const started = await actOnSuggestion(USER, suggestion.id, { action: "start", requestId: uuid(), ownerToken: TAB }, at(2 * MIN));
    expect(started).toMatchObject({ ok: true, response: { session: { problemCreated: false, problem: { id: existing.id } } } });
    const [problem] = await getDb().select().from(schema.problems).where(eq(schema.problems.id, existing.id));
    expect(problem).toMatchObject({ similarSlugs: ["3sum-closest"], topicTags: ["Array"] });
  });

  it("keeps each user's suggestions to themselves", async () => {
    await captured("two-sum", ["3sum"]);
    await captured("two-sum", ["4sum"], OTHER);
    const mine = suggestionOf(await daily());
    const theirs = suggestionOf(await daily(T0, OTHER));
    expect(theirs.target.slug).toBe("4sum");
    expect(await actOnSuggestion(OTHER, mine.id, { action: "skip", requestId: uuid() }, T0)).toEqual({ ok: false, error: "suggestion_not_found" });
    expect((await listSuggestions(OTHER, T0)).suggestions.map((item) => item.id)).toEqual([theirs.id]);
    const exported: { type: string; data: unknown }[] = [];
    for await (const row of iterateAccountExport({ id: USER, name: "Owner", email: "suggest@example.test", image: null })) exported.push(row);
    expect(exported.filter((row) => row.type === "suggestion").map((row) => (row.data as { id: string }).id)).toEqual([mine.id]);
  });
});
