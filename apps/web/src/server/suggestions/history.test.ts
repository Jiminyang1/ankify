import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SimilarQuestionInput } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { and, eq } from "drizzle-orm";
import { DELETE as deleteProblem } from "@/app/api/problems/[id]/route";
import { getRequestUser } from "@/server/auth";
import { ingestSessionObservations, startPracticeSession } from "@/server/practice-sessions/commands";
import { upsertLeetcodeProblem } from "@/server/problem-upsert";
import { MAX_SUGGESTION_CANDIDATES_PER_USER } from "@/server/resource-limits";
import { iterateAccountExport } from "@/server/account-export";
import { createTestDb } from "@/server/test-db";
import { loadKnownAttemptedSlugs, mergeAttemptHistory } from "./history";

vi.mock("@/server/auth", () => ({
  getRequestUser: vi.fn(),
  unauthorizedResponse: () => Response.json({ error: "unauthorized" }, { status: 401 }),
}));

const testDb = createTestDb();
const USER = "history-user";
const OTHER = "history-other";
const T0 = new Date("2026-09-30T12:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

const meta = (slug: string, similarQuestions?: SimilarQuestionInput[]) => ({
  leetcodeSlug: slug,
  title: slug,
  difficulty: "Medium" as const,
  url: `https://leetcode.com/problems/${slug}/`,
  topicTags: ["Array"],
  similarSlugs: similarQuestions?.map((question) => question.slug) ?? [],
  ...(similarQuestions ? { similarQuestions } : {}),
});
const threeSum: SimilarQuestionInput = { slug: "3sum", title: "3Sum", difficulty: "Medium", paidOnly: false };
const premium: SimilarQuestionInput = { slug: "two-sum-iii", title: "Two Sum III", difficulty: "Easy", paidOnly: true };

const upsert = (userId: string, input: ReturnType<typeof meta>, now: Date) =>
  getDb().transaction((tx) => upsertLeetcodeProblem(tx, userId, input, { enrollment: "awaiting_initial", now }));
const candidates = (userId = USER) =>
  getDb().select().from(schema.suggestionCandidates).where(eq(schema.suggestionCandidates.userId, userId));
const history = (userId = USER) =>
  getDb().select().from(schema.attemptHistory).where(eq(schema.attemptHistory.userId, userId));

beforeAll(() => testDb.migrate());
beforeEach(async () => {
  await getDb().delete(schema.user);
  await getDb().insert(schema.user).values([
    { id: USER, name: "Owner", email: "history@example.test" },
    { id: OTHER, name: "Other", email: "history-other@example.test" },
  ]);
});
afterAll(() => testDb.cleanup());

describe("suggestion candidates", () => {
  it("records verified similar questions when a practice session starts on a problem", async () => {
    const started = await startPracticeSession(USER, {
      requestId: crypto.randomUUID(),
      ownerToken: "aaaaaaaa-0000-4000-8000-00000000000a",
      mode: "practice",
      target: { kind: "leetcode", problem: meta("two-sum", [threeSum, premium]) },
      baseline: { state: "none" },
      supersedePendingRating: false,
    }, T0);
    expect(started.ok).toBe(true);
    expect((await candidates()).map(({ slug, title, difficulty, paidOnly, source, verifiedAt, topicTags }) => ({ slug, title, difficulty, paidOnly, source, verifiedAt, topicTags }))
      .sort((a, b) => a.slug.localeCompare(b.slug))).toEqual([
      { slug: "3sum", title: "3Sum", difficulty: "Medium", paidOnly: false, source: "similar_question", verifiedAt: T0, topicTags: [] },
      { slug: "two-sum-iii", title: "Two Sum III", difficulty: "Easy", paidOnly: true, source: "similar_question", verifiedAt: T0, topicTags: [] },
    ]);
    expect(await candidates(OTHER)).toEqual([]);
  });

  it("refreshes metadata on a later read, keeps the first source's topics, and ignores older extensions", async () => {
    await upsert(USER, meta("two-sum", [threeSum]), T0);
    await getDb().update(schema.suggestionCandidates).set({ topicTags: ["Two Pointers"], source: "problem_list" });
    await upsert(USER, meta("two-sum", [{ ...threeSum, title: "3Sum (renamed)", paidOnly: true }]), at(10));
    expect(await candidates()).toMatchObject([
      { slug: "3sum", title: "3Sum (renamed)", paidOnly: true, verifiedAt: at(10), topicTags: ["Two Pointers"], source: "problem_list" },
    ]);
    await upsert(USER, meta("two-sum"), at(20));
    expect(await candidates()).toMatchObject([{ verifiedAt: at(10) }]);
  });

  it("stops adding new candidates at the per-user cap but keeps refreshing known ones", async () => {
    const filler = Array.from({ length: MAX_SUGGESTION_CANDIDATES_PER_USER - 1 }, (_, index) => ({
      id: `filler-${index}`, userId: USER, slug: `filler-${index}`, title: "Filler", difficulty: "Easy" as const, paidOnly: false,
      source: "problem_list" as const, verifiedAt: T0,
    }));
    for (let index = 0; index < filler.length; index += 500) await getDb().insert(schema.suggestionCandidates).values(filler.slice(index, index + 500));
    await upsert(USER, meta("two-sum", [threeSum, premium, { ...threeSum, slug: "4sum", title: "4Sum" }, { ...threeSum, slug: "filler-0", title: "Refreshed" }]), at(5));
    const rows = await candidates();
    expect(rows).toHaveLength(MAX_SUGGESTION_CANDIDATES_PER_USER);
    expect(rows.filter((row) => ["3sum", "two-sum-iii", "4sum"].includes(row.slug)).map((row) => row.slug)).toEqual(["3sum"]);
    expect(rows.find((row) => row.slug === "filler-0")).toMatchObject({ title: "Refreshed", verifiedAt: at(5) });
  });
});

describe("attempt history", () => {
  it("merges per source; an accepted problem never goes back to attempted", async () => {
    const merge = (entries: { slug: string; status: "attempted" | "accepted" }[], now: Date, source: "leetcode_status" | "user_marked" = "leetcode_status") =>
      mergeAttemptHistory(USER, { source, sourceAccount: source === "user_marked" ? null : "leet_user", entries }, now);
    expect(await merge([{ slug: "two-sum", status: "attempted" }, { slug: "two-sum", status: "accepted" }, { slug: "3sum", status: "attempted" }], T0)).toEqual({ merged: 2, coverage: null });
    await merge([{ slug: "two-sum", status: "attempted" }, { slug: "3sum", status: "accepted" }], at(1));
    await merge([{ slug: "two-sum", status: "attempted" }], at(2), "user_marked");
    const rows = (await history()).map(({ slug, status, source, sourceAccount, observedAt }) => ({ slug, status, source, sourceAccount, observedAt }));
    expect(rows.sort((a, b) => `${a.slug}${a.source}`.localeCompare(`${b.slug}${b.source}`))).toEqual([
      { slug: "3sum", status: "accepted", source: "leetcode_status", sourceAccount: "leet_user", observedAt: at(1) },
      { slug: "two-sum", status: "accepted", source: "leetcode_status", sourceAccount: "leet_user", observedAt: at(1) },
      { slug: "two-sum", status: "attempted", source: "user_marked", sourceAccount: null, observedAt: at(2) },
    ]);
    expect(await history(OTHER)).toEqual([]);
  });

  it("records how far each read got, per scope and account, as last written", async () => {
    const read = (scope: "problem_list_accepted" | "problem_list_tried", sourceAccount: string, readCount: number, complete: boolean, now: Date) =>
      mergeAttemptHistory(USER, { source: "leetcode_status", sourceAccount, entries: [], coverage: { scope, read: readCount, total: 250, complete } }, now);
    expect((await read("problem_list_accepted", "leet_user", 100, false, T0)).coverage).toEqual({
      scope: "problem_list_accepted", sourceAccount: "leet_user", read: 100, total: 250, complete: false, syncedAt: T0.toISOString(),
    });
    await read("problem_list_accepted", "leet_user", 250, true, at(1));
    await read("problem_list_accepted", "second_account", 50, false, at(2));
    await read("problem_list_tried", "leet_user", 20, true, at(3));
    const rows = await getDb().select().from(schema.attemptHistoryCoverage).where(eq(schema.attemptHistoryCoverage.userId, USER));
    expect(rows.map(({ scope, sourceAccount, read: count, complete }) => `${scope}/${sourceAccount}/${count}/${complete}`).sort()).toEqual([
      "problem_list_accepted/leet_user/250/true",
      "problem_list_accepted/second_account/50/false",
      "problem_list_tried/leet_user/20/true",
    ]);

    await mergeAttemptHistory(USER, { source: "user_marked", sourceAccount: null, entries: [{ slug: "two-sum", status: "attempted" }] }, at(4));
    await mergeAttemptHistory(OTHER, { source: "user_marked", sourceAccount: null, entries: [{ slug: "their-one", status: "attempted" }] }, at(4));
    const exported: { type: string; data: unknown }[] = [];
    for await (const row of iterateAccountExport({ id: USER, name: "Owner", email: "history@example.test", image: null })) exported.push(row);
    expect(exported.filter((row) => row.type === "attempt_history").map((row) => row.data)).toMatchObject([{ slug: "two-sum", source: "user_marked" }]);
    expect(exported.filter((row) => row.type === "attempt_history_coverage")).toHaveLength(3);
  });

  it("keeps a deleted problem's slug as history, accepted when it was solved, and only for its owner", async () => {
    const solved = await upsert(USER, meta("two-sum"), T0);
    const failed = await upsert(USER, meta("3sum"), T0);
    const theirs = await upsert(OTHER, meta("4sum"), T0);
    if (!solved.ok || !failed.ok || !theirs.ok) throw new Error("setup");
    await getDb().insert(schema.submissions).values({ id: "s-1", userId: USER, problemId: solved.problem.id, language: "python3", code: "x", status: "Accepted" });
    const started = await startPracticeSession(USER, {
      requestId: crypto.randomUUID(), ownerToken: "aaaaaaaa-0000-4000-8000-00000000000a", mode: "practice",
      target: { kind: "problem", problemId: failed.problem.id }, baseline: { state: "none" }, supersedePendingRating: false,
    }, at(1));
    if (!started.ok) throw new Error(started.error);
    await ingestSessionObservations(USER, started.response.session.id, { observations: [{ leetcodeSubmissionId: "901", verdict: "Wrong Answer", detailUnavailable: true }] }, at(2));

    const remove = (problemId: string) => deleteProblem(new Request(`https://ankify.test/api/problems/${problemId}`, { method: "DELETE" }), { params: Promise.resolve({ id: problemId }) });
    vi.mocked(getRequestUser).mockResolvedValue({ id: USER } as never);
    expect((await remove(theirs.problem.id)).status).toBe(404);
    expect((await remove(solved.problem.id)).status).toBe(200);
    expect((await remove(failed.problem.id)).status).toBe(200);
    expect((await remove(failed.problem.id)).status).toBe(404);

    expect((await history()).map(({ slug, status, source }) => ({ slug, status, source })).sort((a, b) => a.slug.localeCompare(b.slug))).toEqual([
      { slug: "3sum", status: "attempted", source: "deleted_problem" },
      { slug: "two-sum", status: "accepted", source: "deleted_problem" },
    ]);
    expect(await history(OTHER)).toEqual([]);
    expect(await getDb().select().from(schema.problems).where(and(eq(schema.problems.userId, OTHER), eq(schema.problems.id, theirs.problem.id)))).toHaveLength(1);
  });

  it("knows every attempted slug: problems (archived too) and history, per user", async () => {
    const archived = await upsert(USER, meta("archived-one"), T0);
    if (!archived.ok) throw new Error("setup");
    await getDb().update(schema.problems).set({ archivedAt: T0 }).where(eq(schema.problems.id, archived.problem.id));
    await upsert(USER, meta("active-one"), T0);
    await upsert(OTHER, meta("their-one"), T0);
    await mergeAttemptHistory(USER, { source: "user_marked", sourceAccount: null, entries: [{ slug: "marked-one", status: "attempted" }] }, T0);
    expect([...(await loadKnownAttemptedSlugs(getDb(), USER))].sort()).toEqual(["active-one", "archived-one", "marked-one"]);
  });
});
