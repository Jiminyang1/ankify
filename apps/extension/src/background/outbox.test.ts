import { describe, expect, it, vi } from "vitest";
import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  backoffMs,
  createMemoryOutboxStore,
  createOutbox,
  type DeliveryOutcome,
  type OutboxOperation,
} from "./outbox";

const scope = { accountId: "user-1", apiOrigin: "https://ankify.test" };
let clock = 1_000_000;
const now = () => clock;

function op(id: string, sessionId = "s1", overrides: Partial<Pick<OutboxOperation, "accountId" | "kind">> = {}) {
  return { id, sessionId, accountId: scope.accountId, apiOrigin: scope.apiOrigin, kind: "command" as const, path: `/api/practice-sessions/${sessionId}/commands`, body: { requestId: id }, ...overrides };
}

function setup(respond: (operation: OutboxOperation) => DeliveryOutcome | Promise<DeliveryOutcome>) {
  const store = createMemoryOutboxStore();
  const deliver = vi.fn(async (operation: OutboxOperation) => respond(operation));
  const outbox = createOutbox({ store, deliver, now, random: () => 0.5 });
  return { store, deliver, outbox };
}

describe("outbox", () => {
  it("persists operations before sending and ignores re-enqueued ids", async () => {
    clock = 1_000_000;
    const { store, outbox, deliver } = setup(() => ({ kind: "delivered" }));
    await outbox.enqueue(op("a"));
    await outbox.enqueue({ ...op("a"), body: { changed: true } });
    expect(await store.all()).toMatchObject([{ id: "a", body: { requestId: "a" }, attempts: 0, state: "pending" }]);
    expect(deliver).not.toHaveBeenCalled();
    expect(await outbox.flush(scope)).toMatchObject({ delivered: 1 });
    expect(await store.all()).toEqual([]);
  });

  it("delivers each session's operations in order and holds back only the session that must retry", async () => {
    clock = 1_000_000;
    const sent: string[] = [];
    const { outbox, store } = setup((operation) => {
      sent.push(operation.id);
      return operation.id === "s1-observe" ? { kind: "retry", status: 503 } : { kind: "delivered" };
    });
    await outbox.enqueue(op("s1-observe", "s1"));
    clock += 1;
    await outbox.enqueue(op("s2-finish", "s2"));
    clock += 1;
    await outbox.enqueue(op("s1-finish", "s1"));
    expect(await outbox.flush(scope)).toMatchObject({ delivered: 1, retrying: 1 });
    expect(sent).toEqual(["s1-observe", "s2-finish"]);
    expect((await store.all()).map((operation) => operation.id).sort()).toEqual(["s1-finish", "s1-observe"]);
  });

  it("replays a request whose response was lost, and the server applies it once", async () => {
    clock = 1_000_000;
    const applied = new Set<string>();
    let dropNext = true;
    const { outbox, store } = setup((operation) => {
      applied.add(operation.id);
      if (dropNext) {
        dropNext = false;
        return { kind: "retry", status: null };
      }
      return { kind: "delivered" };
    });
    await outbox.enqueue(op("finish"));
    await outbox.flush(scope);
    expect(await store.all()).toMatchObject([{ id: "finish", attempts: 1 }]);
    expect(await outbox.flush(scope)).toMatchObject({ delivered: 0 });
    clock += BACKOFF_MAX_MS;
    expect(await outbox.flush(scope)).toMatchObject({ delivered: 1 });
    expect([...applied]).toEqual(["finish"]);
  });

  it("pauses everything on an expired Ankify session and keeps the operations", async () => {
    clock = 1_000_000;
    const { outbox, store, deliver } = setup(() => ({ kind: "auth" }));
    await outbox.enqueue(op("a", "s1"));
    clock += 1;
    await outbox.enqueue(op("b", "s2"));
    expect(await outbox.flush(scope)).toMatchObject({ authRequired: true, delivered: 0 });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(await store.all()).toHaveLength(2);
    expect((await outbox.status(scope)).lastError).toMatchObject({ kind: "auth", status: 401 });
  });

  it("waits at least the server's Retry-After and backs off exponentially within bounds", async () => {
    clock = 1_000_000;
    const { outbox, store } = setup(() => ({ kind: "retry", status: 429, retryAfterMs: 90_000 }));
    await outbox.enqueue(op("a"));
    await outbox.flush(scope);
    expect((await store.all())[0]!.nextAttemptAt).toBe(clock + 90_000);
    expect(backoffMs(1, () => 0.5)).toBe(BACKOFF_BASE_MS);
    expect(backoffMs(3, () => 0.5)).toBe(4 * BACKOFF_BASE_MS);
    expect(backoffMs(30, () => 1)).toBe(Math.round(BACKOFF_MAX_MS * 1.2));
    expect(backoffMs(1, () => 0)).toBe(Math.round(BACKOFF_BASE_MS * 0.8));
  });

  it("drops a rejected operation, records why, and continues with later work", async () => {
    clock = 1_000_000;
    const { outbox, store } = setup((operation) =>
      operation.id === "finish" ? { kind: "rejected", status: 409, code: "invalid_transition" } : { kind: "delivered" },
    );
    await outbox.enqueue(op("finish"));
    clock += 1;
    await outbox.enqueue({ ...op("rate"), kind: "rating" });
    expect(await outbox.flush(scope)).toMatchObject({ rejected: 1, delivered: 1 });
    expect(await store.all()).toEqual([]);
    expect((await outbox.status(scope)).rejections).toMatchObject([{ id: "finish", code: "invalid_transition", status: 409 }]);
  });

  it("keeps a part blocked by the storage cap until the user retries, without holding back the session", async () => {
    clock = 1_000_000;
    let capacity = false;
    const { outbox, store } = setup((operation) =>
      operation.id === "observe" && !capacity
        ? { kind: "blocked", body: { observations: ["blocked-one"] }, code: "capacity_blocked" }
        : { kind: "delivered" },
    );
    await outbox.enqueue({ ...op("observe"), kind: "observations" });
    clock += 1;
    await outbox.enqueue(op("finish"));
    expect(await outbox.flush(scope)).toMatchObject({ blocked: 1, delivered: 1 });
    expect(await store.all()).toMatchObject([{ id: "observe", state: "blocked", body: { observations: ["blocked-one"] } }]);
    expect(await outbox.flush(scope)).toMatchObject({ blocked: 1, delivered: 0 });
    expect(await outbox.status(scope)).toMatchObject({ pending: 0, blocked: 1 });
    capacity = true;
    await outbox.retryBlocked(scope);
    expect(await outbox.flush(scope)).toMatchObject({ delivered: 1 });
  });

  it("never replays one account's operations under another", async () => {
    clock = 1_000_000;
    const { outbox, deliver } = setup(() => ({ kind: "delivered" }));
    await outbox.enqueue(op("mine"));
    await outbox.enqueue(op("theirs", "s9", { accountId: "user-2" }));
    await outbox.enqueue({ ...op("other-origin"), apiOrigin: "https://staging.ankify.test" });
    await outbox.flush(scope);
    expect(deliver.mock.calls.map(([operation]) => operation.id)).toEqual(["mine"]);
    expect(await outbox.status(scope)).toMatchObject({ pending: 0, otherAccounts: 2 });
  });

  it("shares one run between concurrent flushes", async () => {
    clock = 1_000_000;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { outbox, deliver } = setup(async () => {
      await gate;
      return { kind: "delivered" };
    });
    await outbox.enqueue(op("a"));
    const first = outbox.flush(scope);
    const second = outbox.flush(scope);
    release();
    expect(await first).toBe(await second);
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
