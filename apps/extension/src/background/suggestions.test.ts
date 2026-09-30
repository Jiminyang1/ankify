import type { SuggestionDto } from "@ankify/contracts";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api";
import { createSuggestionsClient } from "./suggestions";

const suggestion = (ordinal: number) => ({ id: `s${ordinal}`, ordinal }) as SuggestionDto;
const ok = <T,>(data: T) => ({ ok: true as const, status: 200, data });

/** A fake API answering GET and POST /api/suggestions from the given lists. */
function fakeApi(lists: SuggestionDto[][], daily: SuggestionDto | null) {
  const calls: { path: string; body?: Record<string, unknown> }[] = [];
  const request = vi.fn(async (path: string, init: { body?: Record<string, unknown> } = {}) => {
    calls.push({ path, body: init.body });
    if (path === "/api/suggestions" && !init.body) return ok({ dateKey: "2026-09-30", suggestions: lists.shift() ?? [] });
    if (path === "/api/suggestions") return ok(daily ? { suggestion: daily, idempotentReplay: false } : { suggestion: null, reason: "no_candidates" });
    return { ok: false as const, kind: "network" as const, status: null };
  });
  return { api: { request } as unknown as ApiClient, calls };
}

describe("suggestions client", () => {
  it("asks for the day's suggestion only when today has none", async () => {
    const existing = fakeApi([[suggestion(0), suggestion(1)]], null);
    expect(await createSuggestionsClient({ api: existing.api, newId: () => "r" }).today()).toMatchObject({ ok: true, response: { exhausted: false, suggestions: [{ id: "s0" }, { id: "s1" }] } });
    expect(existing.calls.map((call) => call.path)).toEqual(["/api/suggestions"]);

    const missing = fakeApi([[], [suggestion(0)]], suggestion(0));
    expect(await createSuggestionsClient({ api: missing.api, newId: () => "r" }).today()).toMatchObject({ ok: true, response: { exhausted: false, suggestions: [{ id: "s0" }] } });
    expect(missing.calls).toEqual([{ path: "/api/suggestions" }, { path: "/api/suggestions", body: { requestId: "r", kind: "daily" } }, { path: "/api/suggestions" }]);
  });

  it("reports when nothing new could be suggested, and failures as error codes", async () => {
    const none = fakeApi([[]], null);
    expect(await createSuggestionsClient({ api: none.api, newId: () => "r" }).today()).toEqual({ ok: true, response: { dateKey: "2026-09-30", suggestions: [], exhausted: true } });
    const offline = { request: vi.fn(async () => ({ ok: false, kind: "network", status: null })) } as unknown as ApiClient;
    expect(await createSuggestionsClient({ api: offline, newId: () => "r" }).today()).toEqual({ ok: false, error: "offline" });
    const handled = { request: vi.fn(async () => ({ ok: false, kind: "rejected", status: 409, code: "suggestion_already_handled" })) } as unknown as ApiClient;
    expect(await createSuggestionsClient({ api: handled, newId: () => "r" }).act("s0", "skip")).toEqual({ ok: false, error: "suggestion_already_handled" });
  });
});
