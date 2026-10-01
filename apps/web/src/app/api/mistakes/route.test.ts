import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@ankify/db";
import { eq } from "drizzle-orm";
import { getRequestUser } from "@/server/auth";
import { ingestSessionObservations, runSessionCommand, startPracticeSession } from "@/server/practice-sessions/commands";
import { createTestDb } from "@/server/test-db";
import { GET as getProfile } from "./profile/route";
import { POST as postMistake } from "./route";

// Route-level checks for session-sourced mistakes and the
// profile: authentication, validation, and status mapping. Scoring rules are
// covered in server/mistake-profile.test.ts and core/profile.test.ts.
vi.mock("@/server/auth", () => ({
  getRequestUser: vi.fn(),
  unauthorizedResponse: () => Response.json({ error: "unauthorized" }, { status: 401 }),
}));

const testDb = createTestDb();
const user = { id: "user-mistakes-route", email: "mistakes-route@example.com", name: "Route" };
const other = { id: "user-mistakes-route-other", email: "mistakes-route-other@example.com", name: "Other" };
const TAB = "aaaaaaaa-0000-4000-8000-00000000000a";
let slug = 0;

function request(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  return new Request(`https://ankify.test${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

async function session(userId: string, finish: boolean) {
  slug += 1;
  const started = await startPracticeSession(userId, {
    requestId: crypto.randomUUID(),
    ownerToken: TAB,
    mode: "practice",
    target: { kind: "leetcode", problem: { leetcodeSlug: `route-${slug}`, leetcodeId: 3000 + slug, title: "Route", difficulty: "Easy", url: `https://leetcode.com/problems/route-${slug}/`, topicTags: [], similarSlugs: [] } },
    baseline: { state: "none" },
    supersedePendingRating: false,
  });
  if (!started.ok) throw new Error(started.error);
  const { session: row, problem } = started.response;
  await ingestSessionObservations(userId, row.id, {
    observations: [{ leetcodeSubmissionId: String(70_000 + slug), verdict: "Wrong Answer", submittedAt: new Date().toISOString(), detail: { language: "python3", code: "x" } }],
  });
  if (finish) {
    await runSessionCommand(userId, row.id, { type: "finish", requestId: crypto.randomUUID(), ownerToken: TAB, result: "unsuccessful", occurredAt: new Date().toISOString() });
  }
  const [observation] = await getDb().select().from(schema.practiceSessionSubmissions).where(eq(schema.practiceSessionSubmissions.sessionId, row.id));
  return { sessionId: row.id, problemId: problem.id, observationId: observation!.id };
}

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values([user, other]);
});

beforeEach(async () => {
  await getDb().delete(schema.problems);
  await getDb().delete(schema.settings);
  vi.mocked(getRequestUser).mockReset().mockResolvedValue(user as never);
});

afterAll(() => testDb.cleanup());

describe("session-sourced mistakes", () => {
  it("records a mistake on a session with evidence, and maps bad evidence to 400 or 404", async () => {
    const mine = await session(user.id, true);
    const theirs = await session(other.id, true);
    const body = { sourceType: "practice_session", practiceSessionId: mine.sessionId, problemId: mine.problemId, primaryCategory: "edge_case" };

    const created = await postMistake(request("/api/mistakes", { ...body, requestId: crypto.randomUUID(), evidence: [{ kind: "observation", observationId: mine.observationId }] }));
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ mistake: { sourceType: "practice_session", practiceSessionId: mine.sessionId, evidence: [{ kind: "observation" }] } });

    const inverted = await postMistake(request("/api/mistakes", { ...body, requestId: crypto.randomUUID(), evidence: [{ kind: "code_range", submissionId: "s", startLine: 9, endLine: 3 }] }));
    expect(inverted.status).toBe(400);
    const foreign = await postMistake(request("/api/mistakes", { ...body, primaryCategory: "approach", requestId: crypto.randomUUID(), evidence: [{ kind: "observation", observationId: theirs.observationId }] }));
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: "evidence_not_found" });
    const tooMuch = await postMistake(request("/api/mistakes", { ...body, requestId: crypto.randomUUID(), evidence: Array.from({ length: 9 }, () => ({ kind: "observation", observationId: mine.observationId })) }));
    expect(tooMuch.status).toBe(400);
  });
});

describe("profile", () => {
  it("returns the caller's profile, uncached, and requires a session", async () => {
    const done = await session(user.id, true);
    await postMistake(request("/api/mistakes", { sourceType: "practice_session", practiceSessionId: done.sessionId, problemId: done.problemId, primaryCategory: "complexity", requestId: crypto.randomUUID() }));
    const response = await getProfile(request("/api/mistakes/profile"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      windowDays: 90,
      halfLifeDays: 21,
      readiness: { completedSessions: 1, personalized: false, required: { sessions: 3, problems: 2 } },
      categories: [{ category: "complexity", contexts: 1, ready: false, examples: [{ practiceSessionId: done.sessionId }] }],
    });

    vi.mocked(getRequestUser).mockResolvedValue(null as never);
    expect((await getProfile(request("/api/mistakes/profile"))).status).toBe(401);
  });
});
