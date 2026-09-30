import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SuggestionAllocateResponseDto } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { POST as postAttemptHistory } from "@/app/api/attempt-history/route";
import { getRequestUser } from "@/server/auth";
import { upsertLeetcodeProblem } from "@/server/problem-upsert";
import { createTestDb } from "@/server/test-db";
import { POST as postAction } from "./[id]/actions/route";
import { GET as listSuggestions, POST as postSuggestion } from "./route";

// Route-level checks: authentication, validation, the kill switch, and status
// mapping. Allocation and action rules are covered in
// server/suggestions/suggestions.test.ts.
vi.mock("@/server/auth", () => ({
  getRequestUser: vi.fn(),
  unauthorizedResponse: () => Response.json({ error: "unauthorized" }, { status: 401 }),
}));

const testDb = createTestDb();
const user = { id: "suggest-route-user", email: "suggest-route@example.test", name: "Route" };

function request(path: string, body?: unknown) {
  return new Request(`https://ankify.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}
const action = (id: string, body: unknown) => postAction(request(`/api/suggestions/${id}/actions`, body), { params: Promise.resolve({ id }) });

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values(user);
  const similarQuestions = ["3sum", "4sum"].map((slug) => ({ slug, title: slug, difficulty: "Medium" as const, paidOnly: false }));
  await getDb().transaction((tx) =>
    upsertLeetcodeProblem(tx, user.id, {
      leetcodeSlug: "two-sum", title: "Two Sum", difficulty: "Easy", url: "https://leetcode.com/problems/two-sum/",
      topicTags: [], similarSlugs: similarQuestions.map((question) => question.slug), similarQuestions,
    }, { enrollment: "enrolled" }),
  );
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => testDb.cleanup());

describe("suggestion routes", () => {
  it("require a signed-in user", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(null);
    expect((await listSuggestions(request("/api/suggestions"))).status).toBe(401);
    expect((await postSuggestion(request("/api/suggestions", { requestId: crypto.randomUUID(), kind: "daily" }))).status).toBe(401);
    expect((await action("x", { action: "skip", requestId: crypto.randomUUID() })).status).toBe(401);
    expect((await postAttemptHistory(request("/api/attempt-history", { source: "user_marked", sourceAccount: null, entries: [] }))).status).toBe(401);
  });

  it("validate input and honor the kill switch", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(user as never);
    expect((await postSuggestion(request("/api/suggestions", { requestId: crypto.randomUUID(), kind: "weekly" }))).status).toBe(400);
    expect((await postSuggestion(request("/api/suggestions", "{"))).status).toBe(400);
    expect((await action("x", { action: "start", requestId: crypto.randomUUID() })).status).toBe(400);
    const noAccount = await postAttemptHistory(request("/api/attempt-history", { source: "leetcode_status", sourceAccount: null, entries: [] }));
    expect(noAccount.status).toBe(400);

    vi.stubEnv("ANKIFY_DISABLED_WORKFLOWS", "suggestions");
    expect((await listSuggestions(request("/api/suggestions"))).status).toBe(503);
    expect((await postSuggestion(request("/api/suggestions", { requestId: crypto.randomUUID(), kind: "daily" }))).status).toBe(503);
    expect((await action("x", { action: "skip", requestId: crypto.randomUUID() })).status).toBe(503);
    expect((await postAttemptHistory(request("/api/attempt-history", { source: "user_marked", sourceAccount: null, entries: [] }))).status).toBe(503);
  });

  it("allocate, list, and act with the documented statuses", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(user as never);
    const requestId = crypto.randomUUID();
    const created = await postSuggestion(request("/api/suggestions", { requestId, kind: "daily" }));
    expect(created.status).toBe(201);
    const { suggestion } = (await created.json()) as Extract<SuggestionAllocateResponseDto, { suggestion: object }>;
    expect((await postSuggestion(request("/api/suggestions", { requestId, kind: "daily" }))).status).toBe(200);
    expect((await postSuggestion(request("/api/suggestions", { requestId, kind: "extra" }))).status).toBe(409);

    const listed = await listSuggestions(request("/api/suggestions"));
    expect(listed.headers.get("cache-control")).toBe("private, no-store");
    expect(await listed.json()).toMatchObject({ suggestions: [{ id: suggestion.id }] });

    expect((await action("missing", { action: "skip", requestId: crypto.randomUUID() })).status).toBe(404);
    const skipped = await action(suggestion.id, { action: "skip", requestId: crypto.randomUUID() });
    expect(skipped.status).toBe(200);
    expect(await skipped.json()).toMatchObject({ suggestion: { status: "skipped" }, replacement: { status: "pending" } });
    expect((await action(suggestion.id, { action: "skip", requestId: crypto.randomUUID() })).status).toBe(409);

    const merged = await postAttemptHistory(request("/api/attempt-history", { source: "user_marked", sourceAccount: null, entries: [{ slug: "4sum", status: "attempted" }] }));
    expect(merged.status).toBe(200);
    expect(await merged.json()).toEqual({ merged: 1, coverage: null });
  });
});
