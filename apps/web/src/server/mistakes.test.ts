import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { SKILL_DIMENSIONS, quizScopeToDimension } from "@ankify/core";
import { skillDimensionEnum, type MistakeCreateInput, type QuizItem } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { iterateAccountExport } from "./account-export";
import {
  InvalidMistakesCursorError,
  createMistake,
  deleteMistake,
  listMistakes,
  updateMistake,
} from "./mistakes";
import { createTestDb } from "./test-db";

const testDb = createTestDb();
const ALICE = "user-alice";
const BOB = "user-bob";
const REVIEW_REQUEST = "11111111-1111-4111-8111-111111111111";
const BOB_REVIEW_REQUEST = "22222222-2222-4222-8222-222222222222";

let requestCounter = 0;
function requestId() {
  requestCounter += 1;
  return `00000000-0000-4000-8000-${String(requestCounter).padStart(12, "0")}`;
}

function quizItem(id: string): QuizItem {
  return {
    id,
    question: `Question ${id}`,
    choices: ["a", "b", "c", "d"],
    answerIndex: 0,
    explanation: "Because.",
    source: "statement",
    scope: "edge_case",
  };
}

async function seed() {
  const db = getDb();
  await db.insert(schema.user).values([
    { id: ALICE, name: "Alice", email: "alice@example.com" },
    { id: BOB, name: "Bob", email: "bob@example.com" },
  ]);
  await db.insert(schema.problems).values([
    { id: "p1", userId: ALICE, leetcodeSlug: "two-sum", title: "Two Sum", difficulty: "Easy", url: "https://leetcode.com/problems/two-sum/" },
    { id: "p2", userId: ALICE, leetcodeSlug: "3sum", title: "3Sum", difficulty: "Medium", url: "https://leetcode.com/problems/3sum/" },
    { id: "bob-p1", userId: BOB, leetcodeSlug: "two-sum", title: "Two Sum", difficulty: "Easy", url: "https://leetcode.com/problems/two-sum/" },
  ]);
  await db.insert(schema.submissions).values([
    { id: "s1", userId: ALICE, problemId: "p1", language: "python3", code: "pass", status: "Wrong Answer" },
    { id: "s2", userId: ALICE, problemId: "p2", language: "python3", code: "pass", status: "Time Limit Exceeded" },
    { id: "bob-s1", userId: BOB, problemId: "bob-p1", language: "python3", code: "pass", status: "Wrong Answer" },
  ]);
  await db.insert(schema.quizSessions).values({
    id: "q1",
    userId: ALICE,
    problemId: "p1",
    status: "active",
    itemsJson: [quizItem("i1"), quizItem("i2")],
    answersJson: [{ itemId: "i1", selectedIndex: 2, correct: false, answeredAt: "2026-09-01T00:00:00.000Z" }],
  });
  await db.insert(schema.reviewEvents).values([
    { id: "e1", userId: ALICE, problemId: "p1", eventType: "self_recall_rated", fsrsRating: 1, requestId: REVIEW_REQUEST },
    { id: "bob-e1", userId: BOB, problemId: "bob-p1", eventType: "self_recall_rated", fsrsRating: 1, requestId: BOB_REVIEW_REQUEST },
  ]);
}

function manual(overrides: Partial<Extract<MistakeCreateInput, { sourceType: "manual" }>> = {}): MistakeCreateInput {
  return {
    sourceType: "manual",
    requestId: requestId(),
    problemId: "p1",
    primaryCategory: "invariant",
    secondaryTags: [],
    ...overrides,
  };
}

function fromSubmission(submissionId: string, primaryCategory: MistakeCreateInput["primaryCategory"] = "edge_case"): MistakeCreateInput {
  return { sourceType: "submission", submissionId, requestId: requestId(), problemId: "p1", primaryCategory, secondaryTags: [] };
}

async function expectCreated(input: MistakeCreateInput, userId = ALICE) {
  const result = await createMistake(userId, input);
  if (!result.ok) throw new Error(`expected success, got ${result.error}`);
  return result;
}

beforeAll(() => testDb.migrate());

beforeEach(async () => {
  await getDb().delete(schema.user);
  await seed();
});

afterAll(() => testDb.cleanup());

describe("taxonomy", () => {
  it("keeps the contracts enum and the core list identical", () => {
    expect(skillDimensionEnum.options).toEqual([...SKILL_DIMENSIONS]);
  });

  it("maps quiz scopes to dimensions, except mistake_review", () => {
    expect(quizScopeToDimension("edge_case")).toBe("edge_case");
    expect(quizScopeToDimension("approach")).toBe("approach");
    expect(quizScopeToDimension("mistake_review")).toBeNull();
  });
});

describe("createMistake", () => {
  it("records a confirmed manual mistake and stores blank text as null", async () => {
    const result = await expectCreated(manual({ summary: "", nextStep: "Write the invariant first" }));
    expect(result).toMatchObject({ idempotentReplay: false, deduplicated: false });
    expect(result.mistake).toMatchObject({
      problemId: "p1",
      primaryCategory: "invariant",
      sourceType: "manual",
      status: "confirmed",
      origin: "user",
      summary: null,
      nextStep: "Write the invariant first",
      submissionId: null,
      resolvedAt: null,
    });
    expect(result.mistake.confirmedAt).not.toBeNull();
  });

  it("rejects another user's problem", async () => {
    expect(await createMistake(ALICE, manual({ problemId: "bob-p1" }))).toEqual({ ok: false, error: "problem_not_found" });
  });

  it("rejects submissions from another problem or another user", async () => {
    expect(await createMistake(ALICE, fromSubmission("s2"))).toEqual({ ok: false, error: "source_not_found" });
    expect(await createMistake(ALICE, fromSubmission("bob-s1"))).toEqual({ ok: false, error: "source_not_found" });
    expect(await createMistake(ALICE, fromSubmission("missing"))).toEqual({ ok: false, error: "source_not_found" });
  });

  it("links an answered quiz item and rejects unknown or unanswered items", async () => {
    const quiz = (quizItemId: string): MistakeCreateInput => ({
      sourceType: "quiz_answer",
      quizSessionId: "q1",
      quizItemId,
      requestId: requestId(),
      problemId: "p1",
      primaryCategory: "edge_case",
      secondaryTags: [],
    });
    const created = await expectCreated(quiz("i1"));
    expect(created.mistake).toMatchObject({ quizSessionId: "q1", quizItemId: "i1", sourceType: "quiz_answer" });
    expect(await createMistake(ALICE, quiz("i2"))).toEqual({ ok: false, error: "source_not_found" });
    expect(await createMistake(ALICE, quiz("nope"))).toEqual({ ok: false, error: "source_not_found" });
    expect(await createMistake(ALICE, { ...quiz("i1"), problemId: "p2" })).toEqual({ ok: false, error: "source_not_found" });
  });

  it("resolves a review source from the rating's requestId, only for the owner", async () => {
    const review = (reviewRequestId: string): MistakeCreateInput => ({
      sourceType: "review",
      reviewRequestId,
      requestId: requestId(),
      problemId: "p1",
      primaryCategory: "approach",
      secondaryTags: [],
    });
    expect((await expectCreated(review(REVIEW_REQUEST))).mistake.reviewEventId).toBe("e1");
    expect(await createMistake(ALICE, review(BOB_REVIEW_REQUEST))).toEqual({ ok: false, error: "source_not_found" });
    expect(await createMistake(ALICE, review("33333333-3333-4333-8333-333333333333"))).toEqual({
      ok: false,
      error: "source_not_found",
    });
  });

  it("replays the same requestId and refuses a different payload under it", async () => {
    const input = fromSubmission("s1");
    const first = await expectCreated(input);
    const replay = await expectCreated(input);
    expect(replay).toMatchObject({ idempotentReplay: true, mistake: { id: first.mistake.id } });
    expect(await createMistake(ALICE, { ...input, primaryCategory: "complexity" })).toEqual({
      ok: false,
      error: "mistake_request_conflict",
    });
    expect(await getDb().select().from(schema.mistakeRecords)).toHaveLength(1);
  });

  it("dedupes the same source and category, but not a different category", async () => {
    const first = await expectCreated(fromSubmission("s1", "edge_case"));
    const again = await expectCreated(fromSubmission("s1", "edge_case"));
    expect(again).toMatchObject({ deduplicated: true, mistake: { id: first.mistake.id } });
    const other = await expectCreated(fromSubmission("s1", "implementation"));
    expect(other.deduplicated).toBe(false);
    expect(await getDb().select().from(schema.mistakeRecords)).toHaveLength(2);
  });

  it("does not let a dismissed record block a new one", async () => {
    await getDb().insert(schema.mistakeRecords).values({
      id: "candidate-1",
      userId: ALICE,
      problemId: "p1",
      primaryCategory: "edge_case",
      sourceType: "submission",
      submissionId: "s1",
      status: "candidate",
      origin: "ai_suggested",
      requestId: requestId(),
    });
    expect(await updateMistake(ALICE, "candidate-1", { status: "dismissed" })).toMatchObject({
      ok: true,
      mistake: { status: "dismissed" },
    });
    const fresh = await expectCreated(fromSubmission("s1", "edge_case"));
    expect(fresh).toMatchObject({ deduplicated: false });
    expect(fresh.mistake.id).not.toBe("candidate-1");
  });

  it("enforces dedupe in the database as a backstop", async () => {
    await expectCreated(fromSubmission("s1", "edge_case"));
    await expect(
      getDb().insert(schema.mistakeRecords).values({
        id: "dupe",
        userId: ALICE,
        problemId: "p1",
        primaryCategory: "edge_case",
        sourceType: "submission",
        submissionId: "s1",
        requestId: requestId(),
      }),
    ).rejects.toThrow();
  });
});

describe("listMistakes", () => {
  it("returns only the caller's records, newest first, across pages", async () => {
    const created: string[] = [];
    for (const category of ["approach", "invariant", "edge_case"] as const) {
      created.push((await expectCreated(manual({ primaryCategory: category }))).mistake.id);
    }
    await expectCreated(
      { sourceType: "manual", requestId: requestId(), problemId: "bob-p1", primaryCategory: "approach", secondaryTags: [] },
      BOB,
    );

    const first = await listMistakes(ALICE, { status: "confirmed", limit: 2 });
    expect(first.mistakes).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await listMistakes(ALICE, { status: "confirmed", limit: 2, cursor: first.nextCursor! });
    expect(second.nextCursor).toBeNull();

    const ids = [...first.mistakes, ...second.mistakes].map((m) => m.id);
    expect(new Set(ids)).toEqual(new Set(created));
    expect(ids).toHaveLength(3);
  });

  it("filters by problem and category", async () => {
    await expectCreated(manual({ primaryCategory: "approach" }));
    await expectCreated(manual({ problemId: "p2", primaryCategory: "approach" }));
    await expectCreated(manual({ problemId: "p2", primaryCategory: "complexity" }));

    const p2 = await listMistakes(ALICE, { status: "confirmed", limit: 20, problemId: "p2" });
    expect(p2.mistakes.map((m) => m.primaryCategory).sort()).toEqual(["approach", "complexity"]);
    const approach = await listMistakes(ALICE, { status: "confirmed", limit: 20, category: "approach" });
    expect(approach.mistakes).toHaveLength(2);
  });

  it("rejects a malformed cursor", async () => {
    await expect(listMistakes(ALICE, { status: "confirmed", limit: 20, cursor: "not-a-cursor" })).rejects.toBeInstanceOf(
      InvalidMistakesCursorError,
    );
  });
});

describe("updateMistake and deleteMistake", () => {
  it("edits text, tags, category, and resolution for the owner only", async () => {
    const { mistake } = await expectCreated(manual({ summary: "old" }));
    expect(await updateMistake(BOB, mistake.id, { summary: "hijack" })).toEqual({ ok: false, error: "mistake_not_found" });

    const resolved = await updateMistake(ALICE, mistake.id, {
      primaryCategory: "implementation",
      secondaryTags: ["off_by_one"],
      summary: null,
      resolved: true,
    });
    expect(resolved).toMatchObject({
      ok: true,
      mistake: { primaryCategory: "implementation", secondaryTags: ["off_by_one"], summary: null },
    });
    if (!resolved.ok) throw new Error("unreachable");
    expect(resolved.mistake.resolvedAt).not.toBeNull();

    const reopened = await updateMistake(ALICE, mistake.id, { resolved: false });
    expect(reopened).toMatchObject({ ok: true, mistake: { resolvedAt: null } });
  });

  it("refuses a category change that would duplicate another record of the same source", async () => {
    await expectCreated(fromSubmission("s1", "edge_case"));
    const other = await expectCreated(fromSubmission("s1", "implementation"));
    expect(await updateMistake(ALICE, other.mistake.id, { primaryCategory: "edge_case" })).toEqual({
      ok: false,
      error: "duplicate_mistake",
    });
  });

  it("only changes the status of AI candidates", async () => {
    const { mistake } = await expectCreated(manual());
    expect(await updateMistake(ALICE, mistake.id, { status: "dismissed" })).toEqual({
      ok: false,
      error: "invalid_status_transition",
    });

    await getDb().insert(schema.mistakeRecords).values({
      id: "candidate-2",
      userId: ALICE,
      problemId: "p1",
      primaryCategory: "complexity",
      sourceType: "manual",
      status: "candidate",
      origin: "ai_suggested",
      requestId: requestId(),
    });
    const confirmed = await updateMistake(ALICE, "candidate-2", { status: "confirmed" });
    expect(confirmed).toMatchObject({ ok: true, mistake: { status: "confirmed", origin: "ai_suggested" } });
    if (!confirmed.ok) throw new Error("unreachable");
    expect(confirmed.mistake.confirmedAt).not.toBeNull();
  });

  it("deletes only the owner's record", async () => {
    const { mistake } = await expectCreated(manual());
    expect(await deleteMistake(BOB, mistake.id)).toBe(false);
    expect(await deleteMistake(ALICE, mistake.id)).toBe(true);
    expect(await deleteMistake(ALICE, mistake.id)).toBe(false);
  });
});

describe("deletion and export", () => {
  it("clears a deleted submission's link but keeps the user's record", async () => {
    const { mistake } = await expectCreated(fromSubmission("s1"));
    await getDb().delete(schema.submissions).where(eq(schema.submissions.id, "s1"));
    const [row] = await getDb().select().from(schema.mistakeRecords).where(eq(schema.mistakeRecords.id, mistake.id));
    expect(row).toMatchObject({ submissionId: null, sourceType: "submission" });
  });

  it("cascades with the problem and with the account", async () => {
    await expectCreated(manual());
    await expectCreated(manual({ problemId: "p2" }));
    await getDb().delete(schema.problems).where(eq(schema.problems.id, "p1"));
    expect(await getDb().select().from(schema.mistakeRecords)).toHaveLength(1);
    await getDb().delete(schema.user).where(eq(schema.user.id, ALICE));
    expect(await getDb().select().from(schema.mistakeRecords)).toHaveLength(0);
  });

  it("includes the user's records, and only theirs, in the export", async () => {
    const { mistake } = await expectCreated(manual());
    await expectCreated(
      { sourceType: "manual", requestId: requestId(), problemId: "bob-p1", primaryCategory: "approach", secondaryTags: [] },
      BOB,
    );
    const exported: { id: string }[] = [];
    for await (const record of iterateAccountExport({ id: ALICE, email: "alice@example.com", name: "Alice", image: null })) {
      if (record.type === "mistake_record") exported.push(record.data as { id: string });
    }
    expect(exported.map((row) => row.id)).toEqual([mistake.id]);
  });
});
