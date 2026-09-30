import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@ankify/db";
import { getRequestUser } from "@/server/auth";
import { createTestDb } from "@/server/test-db";
import { GET as getDetail } from "./[id]/route";
import { POST as postCommand } from "./[id]/commands/route";
import { POST as postRating } from "./[id]/rating/route";
import { POST as postSubmissions } from "./[id]/submissions/route";
import { GET as getCurrent } from "./current/route";
import { GET as list, POST as start } from "./route";

// Route-level checks against a real throwaway database: authentication, the
// workflow kill switch, validation, owner-token headers, and status mapping.
// Lifecycle rules are covered in server/practice-sessions/*.test.ts.
vi.mock("@/server/auth", () => ({
  getRequestUser: vi.fn(),
  unauthorizedResponse: () => Response.json({ error: "unauthorized" }, { status: 401 }),
}));

const testDb = createTestDb();
const user = { id: "user-sessions-route", email: "sessions-route@example.com", name: "Route" };
const TAB = "aaaaaaaa-0000-4000-8000-00000000000a";
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function request(path: string, init: { method?: string; body?: unknown; ownerToken?: string } = {}) {
  return new Request(`https://ankify.test${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: {
      "content-type": "application/json",
      ...(init.ownerToken ? { "x-ankify-owner-token": init.ownerToken } : {}),
    },
    ...(init.body === undefined ? {} : { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) }),
  });
}

const startBody = (requestId = crypto.randomUUID()) => ({
  requestId,
  ownerToken: TAB,
  mode: "practice",
  target: {
    kind: "leetcode",
    problem: { leetcodeSlug: "two-sum", leetcodeId: 1, title: "Two Sum", difficulty: "Easy", url: "https://leetcode.com/problems/two-sum/" },
  },
  baseline: { state: "none" },
});

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values(user);
});

beforeEach(async () => {
  await getDb().delete(schema.problems);
  await getDb().delete(schema.settings);
  vi.mocked(getRequestUser).mockReset().mockResolvedValue(user as never);
  vi.unstubAllEnvs();
});

afterAll(() => testDb.cleanup());

describe("practice session routes", () => {
  it("require authentication on every route", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(null);
    const responses = await Promise.all([
      start(request("/api/practice-sessions", { body: startBody() })),
      list(request("/api/practice-sessions")),
      getCurrent(request("/api/practice-sessions/current?slug=two-sum")),
      getDetail(request("/api/practice-sessions/s1"), params("s1")),
      postCommand(request("/api/practice-sessions/s1/commands", { body: { type: "defer_rating", requestId: crypto.randomUUID() } }), params("s1")),
      postSubmissions(request("/api/practice-sessions/s1/submissions", { body: { observations: [{ leetcodeSubmissionId: "1", verdict: "Accepted" }] } }), params("s1")),
    ]);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401]);
  });

  it("are unavailable while the workflow is switched off", async () => {
    vi.stubEnv("ANKIFY_DISABLED_WORKFLOWS", "practice_sessions");
    const response = await start(request("/api/practice-sessions", { body: startBody() }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "workflow_disabled" });
    expect(await getDb().select().from(schema.practiceSessions)).toEqual([]);
  });

  it("validates payloads and queries", async () => {
    expect((await start(request("/api/practice-sessions", { body: "{" }))).status).toBe(400);
    expect((await start(request("/api/practice-sessions", { body: { ...startBody(), mode: "cram" } }))).status).toBe(400);
    expect((await getCurrent(request("/api/practice-sessions/current"))).status).toBe(400);
    expect((await list(request("/api/practice-sessions?cursor=not-a-cursor"))).status).toBe(400);
  });

  it("creates with 201, replays with 200, and maps conflicts to 409 and unknown sessions to 404", async () => {
    const body = startBody();
    const created = await start(request("/api/practice-sessions", { body }));
    expect(created.status).toBe(201);
    const { session } = await created.json();
    const replay = await start(request("/api/practice-sessions", { body }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ idempotentReplay: true, session: { id: session.id } });
    expect((await start(request("/api/practice-sessions", { body: { ...body, mode: "due_review" } }))).status).toBe(409);

    const stale = await postCommand(
      request(`/api/practice-sessions/${session.id}/commands`, { body: { type: "heartbeat", ownerToken: "bbbbbbbb-0000-4000-8000-00000000000b", activeMs: 0, observedMs: 0 } }),
      params(session.id),
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "not_owner", session: { id: session.id, ownership: "other_tab" } });
    expect((await getDetail(request("/api/practice-sessions/missing"), params("missing"))).status).toBe(404);
  });

  it("rates only completed reviews, idempotently, behind its own kill switch", async () => {
    const { session } = await (await start(request("/api/practice-sessions", { body: startBody() }))).json();
    const rating = { requestId: crypto.randomUUID(), rating: 3 };
    const early = await postRating(request(`/api/practice-sessions/${session.id}/rating`, { body: rating }), params(session.id));
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ error: "rating_not_pending", session: { type: "initial_learning" } });
    expect((await postRating(request(`/api/practice-sessions/${session.id}/rating`, { body: { ...rating, rating: 0 } }), params(session.id))).status).toBe(400);
    expect((await postRating(request("/api/practice-sessions/missing/rating", { body: rating }), params("missing"))).status).toBe(404);
    vi.stubEnv("ANKIFY_DISABLED_WORKFLOWS", "session_rating");
    expect((await postRating(request(`/api/practice-sessions/${session.id}/rating`, { body: rating }), params(session.id))).status).toBe(503);
  });

  it("reports ownership relative to the tab's owner-token header", async () => {
    const { session } = await (await start(request("/api/practice-sessions", { body: startBody() }))).json();
    const mine = await getCurrent(request("/api/practice-sessions/current?slug=two-sum", { ownerToken: TAB }));
    expect(mine.headers.get("cache-control")).toBe("private, no-store");
    expect(await mine.json()).toMatchObject({ session: { id: session.id, ownership: "you" }, problem: { enrollment: "awaiting_initial" } });
    const other = await getDetail(request(`/api/practice-sessions/${session.id}`, { ownerToken: "not-a-uuid" }), params(session.id));
    expect(await other.json()).toMatchObject({ session: { ownership: "other_tab" }, observations: [] });
  });
});
