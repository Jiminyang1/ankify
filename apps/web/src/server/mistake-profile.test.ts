import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PracticeSessionStartInput } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { and, eq } from "drizzle-orm";
import { iterateAccountExport } from "./account-export";
import { captureProblem } from "./capture";
import { loadMistakeProfile } from "./mistake-profile";
import { createMistake, updateMistake } from "./mistakes";
import { ingestSessionObservations, runSessionCommand, startPracticeSession } from "./practice-sessions/commands";
import { ratePracticeSession } from "./practice-sessions/scheduling";
import { undoLatestProblemReview } from "./review-commands";
import { createTestDb } from "./test-db";

const testDb = createTestDb();
const USER = "profile-owner";
const OTHER = "profile-other";
const TAB = "aaaaaaaa-0000-4000-8000-00000000000a";
const MIN = 60_000;
const T0 = new Date(Date.now() - 2 * 86_400_000);
const at = (ms: number) => new Date(T0.getTime() + ms);
const uuid = () => crypto.randomUUID();
let problemCounter = 0;

function meta(slug: string, leetcodeId: number, topics = ["Array"]) {
  return { leetcodeSlug: slug, leetcodeId, title: slug, difficulty: "Medium" as const, url: `https://leetcode.com/problems/${slug}/`, topicTags: topics, similarSlugs: [] };
}

/** A completed first practice with the given verdicts (one observation each). */
async function practiced(verdicts: string[], options: { userId?: string; topics?: string[]; startAt?: Date } = {}) {
  problemCounter += 1;
  const userId = options.userId ?? USER;
  const startAt = options.startAt ?? at(problemCounter * 10 * MIN);
  const started = await startPracticeSession(userId, {
    requestId: uuid(),
    target: { kind: "leetcode", problem: meta(`p-${problemCounter}`, 100 + problemCounter, options.topics) },
    mode: "practice",
    ownerToken: TAB,
    baseline: { state: "none" },
    supersedePendingRating: false,
  } satisfies PracticeSessionStartInput, startAt);
  if (!started.ok) throw new Error(started.error);
  const { session, problem } = started.response;
  const observed = await ingestSessionObservations(userId, session.id, {
    observations: verdicts.map((verdict, index) => ({
      leetcodeSubmissionId: String(50_000 + problemCounter * 100 + index),
      verdict: verdict as "Accepted",
      submittedAt: new Date(startAt.getTime() + (index + 1) * MIN).toISOString(),
      detail: { language: "python3", code: `attempt ${index}` },
    })),
  }, new Date(startAt.getTime() + 8 * MIN));
  if (!observed.ok) throw new Error(observed.error);
  const result = verdicts.includes("Accepted") ? "solved" : "unsuccessful";
  await runSessionCommand(userId, session.id, { type: "finish", requestId: uuid(), ownerToken: TAB, result, occurredAt: new Date(startAt.getTime() + 9 * MIN).toISOString() }, new Date(startAt.getTime() + 9 * MIN));
  const submissions = await getDb().select().from(schema.submissions).where(and(eq(schema.submissions.userId, userId), eq(schema.submissions.problemId, problem.id)));
  return { sessionId: session.id, problemId: problem.id, submissionIds: submissions.map((row) => row.id) };
}

async function record(input: Parameters<typeof createMistake>[1], userId = USER) {
  const result = await createMistake(userId, input);
  if (!result.ok) throw new Error(result.error);
  return result;
}

const category = async (name: string, userId = USER) => (await loadMistakeProfile(userId)).categories.find((item) => item.category === name);

beforeAll(() => testDb.migrate());
beforeEach(async () => {
  await getDb().delete(schema.user);
  await getDb().insert(schema.user).values([
    { id: USER, name: "Owner", email: "profile@example.test" },
    { id: OTHER, name: "Other", email: "profile-other@example.test" },
  ]);
});
afterAll(() => testDb.cleanup());

describe("session-sourced mistakes", () => {
  it("attributes a mistake on a session's submission to that session and counts the session once", async () => {
    const { sessionId, problemId, submissionIds } = await practiced(["Wrong Answer", "Wrong Answer", "Wrong Answer", "Accepted"]);
    const failed = submissionIds.slice(0, 3);
    for (const submissionId of failed) {
      const created = await record({ sourceType: "submission", submissionId, requestId: uuid(), problemId, primaryCategory: "edge_case" });
      expect(created).toMatchObject({ deduplicated: false, mistake: { practiceSessionId: sessionId } });
    }
    // Every record stays visible; a second one on the same submission and category is the first.
    expect(await createMistake(USER, { sourceType: "submission", submissionId: failed[0]!, requestId: uuid(), problemId, primaryCategory: "edge_case" }))
      .toMatchObject({ ok: true, deduplicated: true });
    // Retries in one session are one context: the profile counts practice, not volume.
    expect(await category("edge_case")).toMatchObject({ contexts: 1, problems: 1, unresolved: 3, ready: false });
  });

  it("dedupes a user's session record per category and validates the session and evidence", async () => {
    const first = await practiced(["Wrong Answer", "Accepted"]);
    const second = await practiced(["Accepted"]);
    const input = { sourceType: "practice_session" as const, practiceSessionId: first.sessionId, problemId: first.problemId, primaryCategory: "invariant" as const };
    const created = await record({ ...input, requestId: uuid(), evidence: [{ kind: "submission", submissionId: first.submissionIds[0]! }] });
    expect(created).toMatchObject({ deduplicated: false, mistake: { sourceType: "practice_session", practiceSessionId: first.sessionId, evidence: [{ kind: "submission" }] } });
    expect(await createMistake(USER, { ...input, requestId: uuid() })).toMatchObject({ ok: true, deduplicated: true, mistake: { id: created.mistake.id } });

    expect(await createMistake(USER, { ...input, practiceSessionId: second.sessionId, requestId: uuid() })).toEqual({ ok: false, error: "source_not_found" });
    const observation = (await getDb().select().from(schema.practiceSessionSubmissions).where(eq(schema.practiceSessionSubmissions.sessionId, second.sessionId)))[0]!;
    expect(await createMistake(USER, { ...input, primaryCategory: "approach", requestId: uuid(), evidence: [{ kind: "observation", observationId: observation.id }] }))
      .toEqual({ ok: false, error: "evidence_not_found" });
    expect(await createMistake(OTHER, { ...input, requestId: uuid() })).toEqual({ ok: false, error: "problem_not_found" });
  });

  it("counts a user's submission record and a confirmed AI finding of one session once, keeping both records", async () => {
    const { sessionId, problemId, submissionIds } = await practiced(["Runtime Error", "Accepted"]);
    await record({ sourceType: "submission", submissionId: submissionIds[0]!, requestId: uuid(), problemId, primaryCategory: "implementation" });
    const aiFinding = { userId: USER, problemId, primaryCategory: "implementation" as const, sourceType: "practice_session" as const, practiceSessionId: sessionId, origin: "ai_suggested" as const };
    const [candidate] = await getDb().insert(schema.mistakeRecords).values({ ...aiFinding, id: "ai-candidate", status: "candidate", requestId: uuid(), summary: "Off-by-one when slicing" }).returning();
    // The index backstops one live AI finding per session and category.
    await expect(getDb().insert(schema.mistakeRecords).values({ ...aiFinding, id: "ai-duplicate", status: "candidate", requestId: uuid() })).rejects.toThrow();

    let profile = await loadMistakeProfile(USER);
    expect(profile.candidates).toMatchObject([{ mistakeId: candidate!.id, category: "implementation", summary: "Off-by-one when slicing" }]);
    expect(profile.categories.find((item) => item.category === "implementation")).toMatchObject({ contexts: 1, unresolved: 1 });

    expect(await updateMistake(USER, candidate!.id, { status: "confirmed" })).toMatchObject({ ok: true });
    profile = await loadMistakeProfile(USER);
    expect(profile.candidates).toEqual([]);
    expect(profile.categories.find((item) => item.category === "implementation")).toMatchObject({ contexts: 1, unresolved: 2 });
    expect(await getDb().select().from(schema.mistakeRecords).where(eq(schema.mistakeRecords.practiceSessionId, sessionId))).toHaveLength(2);
  });
});

describe("mistake profile", () => {
  it("keeps records from before sessions as their own contexts", async () => {
    const captured = await captureProblem(USER, {
      ...meta("legacy", 900), notes: undefined,
      submissions: [
        { leetcodeSubmissionId: "901", language: "python3", code: "a", status: "Wrong Answer", submittedAt: at(0).toISOString() },
        { leetcodeSubmissionId: "902", language: "python3", code: "b", status: "Wrong Answer", submittedAt: at(MIN).toISOString() },
      ],
    });
    if ("error" in captured) throw new Error(captured.error);
    const submissions = await getDb().select().from(schema.submissions).where(eq(schema.submissions.problemId, captured.problemId));
    for (const submission of submissions) {
      const created = await record({ sourceType: "submission", submissionId: submission.id, requestId: uuid(), problemId: captured.problemId, primaryCategory: "complexity" });
      expect(created.mistake.practiceSessionId).toBeNull();
    }
    await record({ sourceType: "manual", requestId: uuid(), problemId: captured.problemId, primaryCategory: "complexity" });
    expect(await category("complexity")).toMatchObject({ contexts: 3, problems: 1 });
    // Recapturing the same history adds nothing.
    await captureProblem(USER, { ...meta("legacy", 900), notes: undefined, submissions: [{ leetcodeSubmissionId: "901", language: "python3", code: "a", status: "Wrong Answer" }] });
    expect(await category("complexity")).toMatchObject({ contexts: 3 });
  });

  it("lowers weakness when records are resolved, and reports it", async () => {
    const a = await practiced(["Wrong Answer"]);
    const b = await practiced(["Wrong Answer"]);
    const one = await record({ sourceType: "practice_session", practiceSessionId: a.sessionId, requestId: uuid(), problemId: a.problemId, primaryCategory: "approach" });
    await record({ sourceType: "practice_session", practiceSessionId: b.sessionId, requestId: uuid(), problemId: b.problemId, primaryCategory: "approach" });
    const before = (await category("approach"))!;
    expect(before).toMatchObject({ contexts: 2, problems: 2, ready: true, weak: true });
    await updateMistake(USER, one.mistake.id, { resolved: true });
    const after = (await category("approach"))!;
    expect(after).toMatchObject({ resolved: 1, unresolved: 1 });
    expect(after.weakness).toBeLessThan(before.weakness);
  });

  it("removes an undone rating's contribution but keeps the user's own records", async () => {
    await getDb().insert(schema.problems).values({
      id: "due", userId: USER, leetcodeSlug: "due", title: "Due", difficulty: "Easy", url: "https://leetcode.com/problems/due/", topicTags: ["Graph"],
      fsrsState: "review", fsrsReps: 2, fsrsStability: 5, fsrsDifficulty: 5, fsrsLastReview: at(-5 * 86_400_000), fsrsDue: at(-MIN),
    });
    const started = await startPracticeSession(USER, { requestId: uuid(), target: { kind: "problem", problemId: "due" }, mode: "due_review", ownerToken: TAB, supersedePendingRating: false }, at(0));
    if (!started.ok) throw new Error(started.error);
    const sessionId = started.response.session.id;
    await runSessionCommand(USER, sessionId, { type: "finish", requestId: uuid(), ownerToken: TAB, result: "unsuccessful", occurredAt: at(MIN).toISOString() }, at(MIN));
    const ratingRequest = uuid();
    await ratePracticeSession(USER, sessionId, { requestId: ratingRequest, rating: 1 }, at(2 * MIN));
    await record({ sourceType: "review", reviewRequestId: ratingRequest, requestId: uuid(), problemId: "due", primaryCategory: "conceptual" });

    let profile = await loadMistakeProfile(USER);
    expect(profile.signals.ratings.again).toBe(1);
    expect(profile.categories.find((item) => item.category === "conceptual")).toMatchObject({ contexts: 1 });
    const ratedWeakness = profile.topics.find((item) => item.topic === "Graph")!.weakness;

    await undoLatestProblemReview(USER, { problemId: "due" });
    profile = await loadMistakeProfile(USER);
    expect(profile.signals.ratings.again).toBe(0);
    expect(profile.categories.find((item) => item.category === "conceptual")).toMatchObject({ contexts: 1 });
    // The failed outcome itself (an observed fact) still counts, less than Again did.
    expect(profile.topics.find((item) => item.topic === "Graph")!.weakness).toBeLessThan(ratedWeakness);
  });

  it("becomes personal after three completed sessions across two problems, and lists topic signals with denominators", async () => {
    await practiced(["Accepted"]);
    await practiced(["Wrong Answer", "Accepted"]);
    expect((await loadMistakeProfile(USER)).readiness).toMatchObject({ completedSessions: 2, personalized: false, required: { sessions: 3, problems: 2 } });
    const failed = await practiced(["Wrong Answer", "Wrong Answer"]);
    // A repeated import of the same submissions adds nothing.
    const replayed = await ingestSessionObservations(USER, failed.sessionId, {
      observations: failed.submissionIds.map((_, index) => ({
        leetcodeSubmissionId: String(50_000 + problemCounter * 100 + index), verdict: "Wrong Answer" as const, submittedAt: at(problemCounter * 10 * MIN + (index + 1) * MIN).toISOString(),
      })),
    }, at(problemCounter * 10 * MIN + 30 * MIN));
    expect(replayed.ok && replayed.response.results.map((item) => item.outcome)).toEqual(["duplicate", "duplicate"]);
    const profile = await loadMistakeProfile(USER);
    expect(profile.readiness).toMatchObject({ completedSessions: 3, distinctProblems: 3, personalized: true });
    expect(profile.topics.find((item) => item.topic === "Array")).toMatchObject({ sessions: 3, accepted: 2, failed: 1, firstTryAccepted: 1, medianFailedBeforeAccepted: 0.5 });
    expect(profile.signals.sessions).toMatchObject({ completed: 3, accepted: 2, failed: 1 });
  });

  it("lowers a weakness through a later clean review of the same problem; retired improvement rows stay exported but count for nothing", async () => {
    const a = await practiced(["Wrong Answer"]);
    const b = await practiced(["Wrong Answer"]);
    for (const context of [a, b]) {
      await record({ sourceType: "practice_session", practiceSessionId: context.sessionId, requestId: uuid(), problemId: context.problemId, primaryCategory: "edge_case" });
    }
    // A "Skill handled well" row from before the feature was retired.
    await getDb().insert(schema.practiceImprovements).values({ id: "legacy-improvement", userId: USER, problemId: b.problemId, practiceSessionId: b.sessionId, category: "edge_case", requestId: uuid(), createdAt: at(30 * MIN) });
    const before = (await category("edge_case"))!;
    expect(before).toMatchObject({ cleanReviews: 0 });

    // Practicing problem a again, accepted, with no edge-case mistake this time.
    // After both earlier sessions (their start times grow with the problem counter).
    const startAt = at((problemCounter + 1) * 10 * MIN);
    const again = await startPracticeSession(USER, { requestId: uuid(), target: { kind: "problem", problemId: a.problemId }, mode: "practice", ownerToken: TAB, baseline: { state: "none" }, supersedePendingRating: false }, startAt);
    if (!again.ok) throw new Error(again.error);
    await ingestSessionObservations(USER, again.response.session.id, {
      observations: [{ leetcodeSubmissionId: "77001", verdict: "Accepted", submittedAt: new Date(startAt.getTime() + MIN).toISOString(), detail: { language: "python3", code: "fixed" } }],
    }, new Date(startAt.getTime() + 2 * MIN));
    await runSessionCommand(USER, again.response.session.id, { type: "finish", requestId: uuid(), ownerToken: TAB, result: "solved", occurredAt: new Date(startAt.getTime() + 3 * MIN).toISOString() }, new Date(startAt.getTime() + 3 * MIN));

    const after = (await category("edge_case"))!;
    expect(after).toMatchObject({ cleanReviews: 1, contexts: 2 });
    expect(after.weakness).toBeLessThan(before.weakness);

    const exported: { type: string; data: unknown }[] = [];
    for await (const row of iterateAccountExport({ id: USER, name: "Owner", email: "profile@example.test", image: null })) exported.push(row);
    expect(exported.filter((row) => row.type === "practice_improvement")).toMatchObject([{ data: { id: "legacy-improvement", category: "edge_case" } }]);
  });

  it("shows nothing of another user's practice", async () => {
    const theirs = await practiced(["Wrong Answer"], { userId: OTHER });
    await record({ sourceType: "practice_session", practiceSessionId: theirs.sessionId, requestId: uuid(), problemId: theirs.problemId, primaryCategory: "approach" }, OTHER);
    const profile = await loadMistakeProfile(USER);
    expect(profile).toMatchObject({ categories: [], candidates: [], topics: [], readiness: { completedSessions: 0 } });
  });
});
