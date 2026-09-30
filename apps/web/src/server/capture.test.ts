import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { captureProblemSchema, type CaptureProblemInput } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { and, eq } from "drizzle-orm";
import { captureProblem } from "./capture";
import { createTestDb } from "./test-db";

const testDb = createTestDb();
const USER = "capture-owner";
const OTHER = "capture-other";
const input = captureProblemSchema.parse({
  leetcodeSlug: "two-sum", leetcodeId: 1, title: "Two Sum", difficulty: "Easy",
  url: "https://leetcode.com/problems/two-sum/", notes: "Keep my explanation",
  submissions: [{ leetcodeSubmissionId: "101", language: "python3", code: "return [0, 1]",
    status: "Accepted", submittedAt: "2026-09-01T12:00:00.000Z" }],
});

async function capture(payload: CaptureProblemInput = input, userId = USER) {
  const result = await captureProblem(userId, payload);
  if ("error" in result) throw new Error(result.error);
  return result;
}

beforeAll(() => testDb.migrate());
beforeEach(async () => {
  await getDb().delete(schema.user);
  await getDb().insert(schema.user).values([
    { id: USER, name: "Owner", email: "capture@example.test" },
    { id: OTHER, name: "Other", email: "capture-other@example.test" },
  ]);
});
afterAll(() => testDb.cleanup());

describe("legacy capture characterization", () => {
  it("initializes a new problem and records capture/import history without a recall rating", async () => {
    const result = await capture();
    expect(result).toMatchObject({ created: true, importedSubmissions: 1, submissionLimitReached: false });
    const [problem] = await getDb().select().from(schema.problems).where(eq(schema.problems.userId, USER));
    expect(problem).toMatchObject({ fsrsState: "new", fsrsReps: 0, fsrsLastReview: null, notes: input.notes });
    const events = await getDb().select().from(schema.reviewEvents).where(eq(schema.reviewEvents.userId, USER));
    expect(events.map((event) => event.eventType).sort()).toEqual(["problem_captured", "submission_imported"]);
    const [submission] = await getDb().select().from(schema.submissions).where(eq(schema.submissions.userId, USER));
    expect(submission).toMatchObject({ problemId: result.problemId, leetcodeSubmissionId: "101", code: "return [0, 1]" });
    expect(submission!.submittedAt.toISOString()).toBe(input.submissions[0]!.submittedAt);
  });

  it("replays capture without duplicating problems, submissions, or events", async () => {
    const first = await capture();
    expect(await capture()).toEqual({ ...first, created: false, importedSubmissions: 0 });
    expect(await getDb().select().from(schema.problems)).toHaveLength(1);
    expect(await getDb().select().from(schema.submissions)).toHaveLength(1);
    expect(await getDb().select().from(schema.reviewEvents)).toHaveLength(2);
  });

  it("characterizes the known stable-ID suppression bug for the Phase 1 fix", async () => {
    await capture();
    const result = await capture({ ...input, submissions: [{ ...input.submissions[0]!, leetcodeSubmissionId: "102" }] });
    // This is current behavior, not the desired identity policy. Phase 1 must
    // change this assertion to retain both separately identified attempts.
    expect(result.importedSubmissions).toBe(0);
  });

  it("recaptures metadata and unarchives without rewriting notes or scheduling", async () => {
    const { problemId } = await capture();
    const memory = {
      fsrsDue: new Date("2026-10-10T12:00:00.000Z"), fsrsStability: 12.4,
      fsrsDifficulty: 4.2, fsrsElapsedDays: 5, fsrsScheduledDays: 12,
      fsrsLearningSteps: 0, fsrsReps: 7, fsrsLapses: 2, fsrsState: "review" as const,
      fsrsLastReview: new Date("2026-09-28T12:00:00.000Z"),
    };
    await getDb().update(schema.problems).set({ ...memory, archivedAt: new Date() })
      .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, USER)));
    await capture({ ...input, title: "Updated title", notes: undefined, submissions: [] });
    const [problem] = await getDb().select().from(schema.problems).where(eq(schema.problems.userId, USER));
    expect(problem).toMatchObject({ ...memory, title: "Updated title", archivedAt: null, notes: input.notes });
  });

  it("keeps the same slug and submission ID independent across users", async () => {
    const first = await capture();
    const other = await capture(input, OTHER);
    expect(other.problemId).not.toBe(first.problemId);
    expect(other.importedSubmissions).toBe(1);
    expect(await getDb().select().from(schema.submissions)).toHaveLength(2);
  });

  it("rejects slug/numeric-ID conflicts without changing either problem", async () => {
    await capture();
    await capture({ ...input, leetcodeSlug: "3sum", leetcodeId: 15, title: "3Sum", submissions: [] });
    const before = await getDb().select().from(schema.problems);
    expect(await captureProblem(USER, { ...input, leetcodeId: 15 })).toMatchObject({ error: "duplicate_problem_conflict" });
    expect(await getDb().select().from(schema.problems)).toEqual(before);
  });

  it("rolls back the problem and submissions when recording history fails", async () => {
    await testDb.exec(`CREATE TRIGGER reject_capture_event BEFORE INSERT ON review_events
      WHEN NEW.event_type = 'submission_imported' BEGIN SELECT RAISE(ABORT, 'injected history failure'); END;`);
    try {
      await expect(capture()).rejects.toThrow();
      expect(await getDb().select().from(schema.problems)).toEqual([]);
      expect(await getDb().select().from(schema.submissions)).toEqual([]);
      expect(await getDb().select().from(schema.reviewEvents)).toEqual([]);
    } finally {
      await testDb.exec("DROP TRIGGER reject_capture_event;");
    }
  });
});
