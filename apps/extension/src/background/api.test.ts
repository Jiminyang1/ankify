import { describe, expect, it, vi } from "vitest";
import { createApiClient, OWNER_TOKEN_HEADER } from "./api";

function client(response: Response | Error) {
  const fetch = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { api: createApiClient({ origin: "https://ankify.test/", fetch }), fetch };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("extension API client", () => {
  it("sends JSON with the session cookie and the tab's owner token", async () => {
    const { api, fetch } = client(json(200, { ok: true }));
    expect(await api.request("/api/x", { body: { a: 1 }, ownerToken: "tab-token" })).toEqual({ ok: true, status: 200, data: { ok: true } });
    expect(fetch).toHaveBeenCalledWith("https://ankify.test/api/x", expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ a: 1 }),
      headers: { "content-type": "application/json", [OWNER_TOKEN_HEADER]: "tab-token" },
    }));
  });

  it("classifies failures into sign-in, retry, and server decisions", async () => {
    expect(await client(json(401, { error: "unauthorized" })).api.request("/x")).toMatchObject({ ok: false, kind: "auth", status: 401 });
    expect(await client(json(429, { error: "rate_limited" }, { "retry-after": "7" })).api.request("/x")).toMatchObject({ kind: "rate_limited", retryAfterMs: 7_000 });
    expect(await client(json(429, { retryAfterSec: 3 })).api.request("/x")).toMatchObject({ kind: "rate_limited", retryAfterMs: 3_000 });
    expect(await client(json(503, { error: "workflow_disabled" })).api.request("/x")).toMatchObject({ kind: "server", code: "workflow_disabled" });
    expect(await client(json(408, {})).api.request("/x")).toMatchObject({ kind: "network", status: 408 });
    expect(await client(new TypeError("Failed to fetch")).api.request("/x")).toEqual({ ok: false, kind: "network", status: null });
    expect(await client(json(409, { error: "not_owner", session: { id: "s1" } })).api.request("/x"))
      .toMatchObject({ kind: "rejected", status: 409, code: "not_owner", body: { session: { id: "s1" } } });
  });
});
