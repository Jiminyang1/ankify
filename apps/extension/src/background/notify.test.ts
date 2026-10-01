import { describe, expect, it } from "vitest";
import { changesSessionState } from "./notify";

describe("session change notifications", () => {
  it("nudges the other surfaces after session changes, not after reads or failures", () => {
    const rating = { type: "session_rating" as const, sessionId: "s1", rating: 3 as const };
    expect(changesSessionState({ channel: "page", message: rating }, { ok: true, queued: false, response: {} })).toBe(true);
    expect(changesSessionState({ channel: "content", message: rating }, { ok: true, queued: true })).toBe(true);
    expect(changesSessionState({ channel: "content", message: rating }, { ok: false, error: "rating_not_pending" })).toBe(false);
    expect(changesSessionState({ channel: "content", message: { type: "page_state", slug: "two-sum" } }, { ok: true, response: {} })).toBe(false);
    expect(changesSessionState({ channel: "page", message: { type: "overview" } }, { ok: true, response: {} })).toBe(false);
    // A retry answers with the sync status, which has no `ok`.
    expect(changesSessionState({ channel: "page", message: { type: "sync_retry" } }, { pending: 0, blocked: 0 })).toBe(true);
  });
});
