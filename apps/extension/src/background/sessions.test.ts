import { describe, expect, it } from "vitest";
import { createAccountState } from "./account";
import type { ApiClient, ApiRequest, ApiResult } from "./api";
import { createMemoryOutboxStore, createOutbox, type DeliveryOutcome, type OutboxOperation } from "./outbox";
import { createSessionController } from "./sessions";

const ORIGIN = "https://ankify.test";
type Call = { path: string; init: ApiRequest };
type Responder = (call: Call) => ApiResult<unknown>;

function harness(respond: Responder, options: { onDelivered?: () => void } = {}) {
  const calls: Call[] = [];
  let online = true;
  let signedInAs = "user-1";
  const api: ApiClient = {
    origin: ORIGIN,
    request: async <T,>(path: string, init: ApiRequest = {}) => {
      calls.push({ path, init });
      if (!online) return { ok: false, kind: "network", status: null } as ApiResult<T>;
      if (path === "/api/me") return { ok: true, status: 200, data: { user: { id: signedInAs, email: "u@x", name: "U" } } } as ApiResult<T>;
      return respond({ path, init }) as ApiResult<T>;
    },
  };
  const kv = new Map<string, unknown>();
  const account = createAccountState({ api, store: { get: async (key) => kv.get(key), set: async (key, value) => void kv.set(key, value) } });
  const store = createMemoryOutboxStore();
  const outbox = createOutbox({
    store,
    deliver: async (operation: OutboxOperation): Promise<DeliveryOutcome> => {
      const result = await api.request(operation.path, { body: operation.body });
      if (result.ok) return { kind: "delivered", data: result.data };
      if (result.kind === "auth") return { kind: "auth" };
      if (result.kind === "rejected") return { kind: "rejected", status: result.status, code: result.code ?? null };
      return { kind: "retry", status: result.status };
    },
  });
  const tabTokens = new Map<number, string>();
  const tabSessions = new Map<number, string[]>();
  const totals = new Map<string, { activeMs: number; observedMs: number }>();
  let id = 0;
  const controller = createSessionController({
    api,
    outbox,
    account,
    tokens: {
      tokenFor: async (tabId) => {
        if (!tabTokens.has(tabId)) tabTokens.set(tabId, `token-tab-${tabId}`);
        return tabTokens.get(tabId)!;
      },
      peek: async (tabId) => tabTokens.get(tabId) ?? null,
      popupToken: async () => "token-popup",
      noteSession: async (tabId, sessionId) => {
        const current = tabSessions.get(tabId) ?? [];
        if (!current.includes(sessionId)) tabSessions.set(tabId, [...current, sessionId]);
      },
      forget: async (tabId) => {
        const token = tabTokens.get(tabId) ?? null;
        const sessionIds = tabSessions.get(tabId) ?? [];
        tabTokens.delete(tabId);
        tabSessions.delete(tabId);
        return { token, sessionIds };
      },
    },
    totals: {
      add: async (sessionId, token, delta) => {
        const key = `${sessionId}:${token}`;
        const current = totals.get(key) ?? { activeMs: 0, observedMs: 0 };
        const next = { activeMs: current.activeMs + delta.activeMs, observedMs: current.observedMs + delta.observedMs };
        totals.set(key, next);
        return next;
      },
    },
    newId: () => `req-${++id}`,
    ...(options.onDelivered ? { onDelivered: options.onDelivered } : {}),
  });
  return {
    controller,
    calls,
    store,
    setOnline: (value: boolean) => void (online = value),
    signIn: (userId: string) => void (signedInAs = userId),
  };
}

const ok = (data: unknown): ApiResult<unknown> => ({ ok: true, status: 200, data });
const bodyOf = (call: Call) => (call.init.body ?? {}) as Record<string, unknown>;

describe("session controller", () => {
  it("reads page state and starts sessions with the tab's own owner token", async () => {
    const { controller, calls } = harness((call) => ok(call.path.startsWith("/api/practice-sessions/current") ? { problem: null, session: null, pendingRating: null } : { ok: true, created: true }));
    await controller.pageState(7, "two-sum");
    expect(calls.at(-1)).toMatchObject({ path: "/api/practice-sessions/current?slug=two-sum", init: { ownerToken: "token-tab-7" } });
    await controller.start({ tabId: 7 }, { target: { kind: "problem", problemId: "p1" }, mode: "due_review", supersedePendingRating: false });
    expect(bodyOf(calls.at(-1)!)).toMatchObject({ ownerToken: "token-tab-7", requestId: "req-1", mode: "due_review", target: { kind: "problem", problemId: "p1" } });
  });

  it("tells a page how many of its session's observations still wait to sync", async () => {
    const { controller, setOnline } = harness((call) =>
      ok(call.path.startsWith("/api/practice-sessions/current") ? { problem: null, session: { id: "s1" }, pendingRating: null } : { ok: true }));
    expect(await controller.pageState(7, "two-sum")).toMatchObject({ ok: true, response: { session: { id: "s1" }, localSync: { pendingObservations: 0 } } });
    await controller.syncStatus(); // the account is confirmed while online
    setOnline(false);
    expect(await controller.observations("s1", [{ leetcodeSubmissionId: "1001", verdict: "Accepted" }])).toEqual({ ok: true, queued: true });
    setOnline(true);
    // The batch waits out its backoff; the page hears it is still unsynced.
    expect(await controller.pageState(7, "two-sum")).toMatchObject({ ok: true, response: { localSync: { pendingObservations: 1 } } });
  });

  it("sends saved work as soon as ankify answers again, without waiting out the backoff", async () => {
    let delivered = 0;
    const { controller, setOnline, store } = harness(
      (call) => ok(call.path.startsWith("/api/practice-sessions/current") ? { problem: null, session: null, pendingRating: null } : { ok: true, session: { id: "s1" } }),
      { onDelivered: () => void (delivered += 1) },
    );
    await controller.syncStatus(); // the account is confirmed while online
    setOnline(false);
    expect(await controller.control({ tabId: 7 }, "s1", { command: "abandon", occurredAt: "2026-09-29T12:00:00.000Z" })).toEqual({ ok: true, queued: true });
    expect((await store.all())[0]!.nextAttemptAt).toBeGreaterThan(Date.now());
    setOnline(true);
    // A page read succeeds: the outbox goes at once.
    await controller.pageState(7, "two-sum");
    await expect.poll(async () => (await store.all()).length).toBe(0);
    expect(delivered).toBe(1);
    expect(await controller.resumeSync()).toBeNull();
  });

  it("requires the server to acknowledge a start", async () => {
    const { controller, setOnline, store } = harness(() => ok({}));
    setOnline(false);
    expect(await controller.start({ tabId: 1 }, { target: { kind: "problem", problemId: "p1" }, mode: "practice", supersedePendingRating: false }))
      .toEqual({ ok: false, error: "offline" });
    expect(await store.all()).toEqual([]);
  });

  it("persists a finish before sending it and returns the server's session when delivered", async () => {
    const { controller, calls, store } = harness((call) => ok({ ok: true, session: { id: "s1", status: "completed" }, echo: bodyOf(call) }));
    const result = await controller.control({ tabId: 7 }, "s1", { command: "finish", result: "solved", occurredAt: "2026-09-29T12:00:00.000Z" });
    expect(result).toMatchObject({ ok: true, queued: false, response: { session: { status: "completed" } } });
    expect(bodyOf(calls.at(-1)!)).toEqual({ type: "finish", requestId: "req-1", ownerToken: "token-tab-7", result: "solved", occurredAt: "2026-09-29T12:00:00.000Z" });
    expect(await store.all()).toEqual([]);
  });

  it("keeps an offline finish for replay with the same request id and account", async () => {
    const { controller, calls, store, setOnline } = harness(() => ok({ ok: true, session: { id: "s1", status: "completed" } }));
    await controller.pageState(7, "two-sum");
    await controller.syncStatus(); // the account is confirmed while online
    setOnline(false);
    expect(await controller.control({ tabId: 7 }, "s1", { command: "abandon", occurredAt: "2026-09-29T12:00:00.000Z" })).toEqual({ ok: true, queued: true });
    expect(await store.all()).toMatchObject([{ id: "req-1", accountId: "user-1", apiOrigin: ORIGIN, sessionId: "s1", kind: "command" }]);
    setOnline(true);
    await store.put({ ...(await store.all())[0]!, nextAttemptAt: 0 });
    expect(await controller.flush()).toMatchObject({ delivered: 1 });
    expect(bodyOf(calls.at(-1)!)).toMatchObject({ type: "abandon", requestId: "req-1" });
  });

  it("surfaces a server rejection of a durable command", async () => {
    const { controller } = harness(() => ({ ok: false, kind: "rejected", status: 409, code: "not_owner" }));
    expect(await controller.control({ tabId: 7 }, "s1", { command: "finish", result: "unsuccessful", occurredAt: "2026-09-29T12:00:00.000Z" }))
      .toEqual({ ok: false, error: "not_owner" });
  });

  it("sends cumulative activity totals per session and tab, and never heartbeats for an unknown tab", async () => {
    const { controller, calls } = harness(() => ok({ ok: true, session: { id: "s1" } }));
    expect(await controller.activity(9, "s1", { activeMs: 1, observedMs: 1 }, "available")).toEqual({ ok: false, error: "not_owner" });
    await controller.pageState(7, "two-sum");
    await controller.activity(7, "s1", { activeMs: 10_000, observedMs: 15_000 }, "available");
    await controller.activity(7, "s1", { activeMs: 5_000, observedMs: 15_000 }, "signed_out");
    expect(bodyOf(calls.at(-1)!)).toEqual({ type: "heartbeat", ownerToken: "token-tab-7", activeMs: 15_000, observedMs: 30_000, availability: "signed_out" });
  });

  it("releases the sessions a closed tab controlled, with its token, and nothing for tabs that controlled none", async () => {
    const session = (id: string, ownership: string) => ({ id, ownership, status: "active" });
    const { controller, calls } = harness((call) => {
      if (call.path.startsWith("/api/practice-sessions/current")) return ok({ problem: null, session: session("s-other", "other_tab"), pendingRating: null });
      if (call.path === "/api/practice-sessions") return ok({ created: true, session: session("s1", "you") });
      return ok({ ok: true, session: session("s2", "you") });
    });
    await controller.pageState(7, "two-sum");
    await controller.start({ tabId: 7 }, { target: { kind: "problem", problemId: "p1" }, mode: "practice", supersedePendingRating: false });
    await controller.control({ tabId: 7 }, "s2", { command: "takeover" });
    await controller.pageState(8, "two-sum");

    const before = calls.length;
    expect(await controller.releaseTab(7)).toBe(2);
    expect(calls.slice(before).map((call) => [call.path, bodyOf(call)])).toEqual([
      ["/api/practice-sessions/s1/commands", { type: "release", ownerToken: "token-tab-7" }],
      ["/api/practice-sessions/s2/commands", { type: "release", ownerToken: "token-tab-7" }],
    ]);
    // A tab that only saw another tab's session releases nothing; a second close is a no-op.
    expect(await controller.releaseTab(8)).toBe(0);
    expect(await controller.releaseTab(7)).toBe(0);
    expect(calls).toHaveLength(before + 2);
  });

  it("uses the popup's own token for sessions no tab controls, and stable request ids for ratings", async () => {
    const { controller, calls } = harness(() => ok({ ok: true }));
    await controller.control({ popup: true }, "s1", { command: "abandon", occurredAt: "2026-09-29T12:00:00.000Z" });
    expect(bodyOf(calls.at(-1)!)).toMatchObject({ ownerToken: "token-popup" });
    await controller.rate("s2", 3);
    expect(calls.at(-1)).toMatchObject({ path: "/api/practice-sessions/s2/rating", init: { body: { requestId: "req-2", rating: 3 } } });
    await controller.skipRating("s3");
    expect(calls.at(-1)).toMatchObject({ path: "/api/practice-sessions/s3/commands", init: { body: { type: "dismiss_rating", requestId: "req-3" } } });
  });

  it("never sends one account's queued work while another account is signed in", async () => {
    const { controller, calls, store, setOnline, signIn } = harness(() => ok({ ok: true }));
    await controller.syncStatus();
    setOnline(false);
    await controller.control({ tabId: 7 }, "s1", { command: "finish", result: "solved", occurredAt: "2026-09-29T12:00:00.000Z" });
    setOnline(true);
    for (const operation of await store.all()) await store.put({ ...operation, nextAttemptAt: 0 });
    // Another account signs in right away; the memoized account must not decide.
    signIn("user-2");
    const before = calls.length;
    expect(await controller.flush()).toMatchObject({ delivered: 0 });
    expect(calls.slice(before).some((call) => call.path.endsWith("/commands"))).toBe(false);
    expect(await controller.syncStatus()).toMatchObject({ pending: 0, otherAccounts: 1 });
    signIn("user-1");
    expect(await controller.flush()).toMatchObject({ delivered: 1 });
  });

  it("delivers observations before a later finish of the same session", async () => {
    let finishSeen = false;
    const order: string[] = [];
    const { controller, setOnline, store } = harness((call) => {
      order.push(call.path.endsWith("submissions") ? "observe" : String(bodyOf(call).type));
      if (bodyOf(call).type === "finish") finishSeen = true;
      return ok({ ok: true });
    });
    await controller.pageState(7, "two-sum");
    await controller.syncStatus();
    setOnline(false);
    await controller.observations("s1", [{ leetcodeSubmissionId: "1001", verdict: "Accepted" }]);
    await controller.control({ tabId: 7 }, "s1", { command: "finish", result: "solved", occurredAt: "2026-09-29T12:00:00.000Z" });
    setOnline(true);
    for (const operation of await store.all()) await store.put({ ...operation, nextAttemptAt: 0 });
    await controller.flush();
    expect(finishSeen).toBe(true);
    expect(order.filter((step) => step !== "undefined")).toEqual(["observe", "finish"]);
  });
});
