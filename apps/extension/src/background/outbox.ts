/**
 * Durable outgoing operations (the outbox). Every operation is persisted
 * before it is sent and replayed with the same id until the server answers,
 * so worker restarts, closed popups, and network outages lose nothing and
 * the server's idempotency turns replays into no-ops.
 *
 * Ordering: operations of one session are delivered strictly in creation
 * order (observations land before the Finish that depends on their evidence);
 * different sessions do not block each other. Operations belong to one Ankify
 * account and API origin and are never replayed under another.
 */

export type OutboxKind = "command" | "observations" | "rating";

export type OutboxError = { kind: string; status: number | null; code?: string; at: number };

export type OutboxOperation = {
  /** Stable id, reused on every attempt. */
  id: string;
  accountId: string;
  apiOrigin: string;
  /** Delivery order is kept per session. */
  sessionId: string;
  kind: OutboxKind;
  path: string;
  body: unknown;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  /** `blocked`: part of it needs the user (e.g. the submission storage cap). */
  state: "pending" | "blocked";
  lastError: OutboxError | null;
};

/** A server decision that retrying cannot change, kept briefly for the UI. */
export type OutboxRejection = {
  id: string;
  accountId: string;
  apiOrigin: string;
  sessionId: string;
  kind: OutboxKind;
  status: number | null;
  code: string | null;
  at: number;
};

export interface OutboxStore {
  get(id: string): Promise<OutboxOperation | undefined>;
  put(operation: OutboxOperation): Promise<void>;
  remove(id: string): Promise<void>;
  all(): Promise<OutboxOperation[]>;
  addRejection(rejection: OutboxRejection, keep: number): Promise<void>;
  rejections(): Promise<OutboxRejection[]>;
}

export type DeliveryOutcome =
  | { kind: "delivered"; data?: unknown }
  /** Delivered except a part that needs the user; keep that part, blocked. */
  | { kind: "blocked"; body: unknown; code: string }
  | { kind: "retry"; retryAfterMs?: number; status: number | null; code?: string }
  /** The Ankify session expired: pause everything until sign-in. */
  | { kind: "auth" }
  | { kind: "rejected"; status: number | null; code: string | null };

export type OutboxScope = { accountId: string; apiOrigin: string };

export type FlushReport = {
  delivered: number;
  retrying: number;
  blocked: number;
  rejected: number;
  authRequired: boolean;
  /** Server responses of the operations delivered in this run, by id. */
  responses: Record<string, unknown>;
  /** Rejections recorded in this run, by id. */
  rejections: Record<string, { status: number | null; code: string | null }>;
};

export type OutboxStatus = {
  pending: number;
  blocked: number;
  /** Waiting for another account to sign in again; never sent meanwhile. */
  otherAccounts: number;
  nextAttemptAt: number | null;
  lastError: OutboxError | null;
  rejections: OutboxRejection[];
};

export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 5 * 60_000;
const KEEP_REJECTIONS = 20;

/** Exponential backoff with ±20% jitter; a server delay is never shortened. */
export function backoffMs(attempts: number, random: () => number, retryAfterMs?: number) {
  const exponential = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
  const jittered = Math.round(exponential * (0.8 + 0.4 * random()));
  return Math.max(jittered, retryAfterMs ?? 0);
}

const byCreation = (a: OutboxOperation, b: OutboxOperation) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const inScope = (scope: OutboxScope) => (operation: OutboxOperation) =>
  operation.accountId === scope.accountId && operation.apiOrigin === scope.apiOrigin;

export function createOutbox(deps: {
  store: OutboxStore;
  deliver: (operation: OutboxOperation) => Promise<DeliveryOutcome>;
  now?: () => number;
  random?: () => number;
}) {
  const { store, deliver } = deps;
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  let tail: Promise<unknown> = Promise.resolve();

  async function runFlush(scope: OutboxScope): Promise<FlushReport> {
    const report: FlushReport = { delivered: 0, retrying: 0, blocked: 0, rejected: 0, authRequired: false, responses: {}, rejections: {} };
    const operations = (await store.all()).filter(inScope(scope)).sort(byCreation);
    const halted = new Set<string>();
    for (const operation of operations) {
      if (halted.has(operation.sessionId)) continue;
      // A blocked part waits for the user without holding back later work.
      if (operation.state === "blocked") {
        report.blocked += 1;
        continue;
      }
      if (operation.nextAttemptAt > now()) {
        halted.add(operation.sessionId);
        continue;
      }
      const outcome = await deliver(operation);
      const at = now();
      switch (outcome.kind) {
        case "delivered":
          await store.remove(operation.id);
          report.delivered += 1;
          report.responses[operation.id] = outcome.data;
          break;
        case "blocked":
          await store.put({
            ...operation,
            body: outcome.body,
            state: "blocked",
            attempts: operation.attempts + 1,
            lastError: { kind: "blocked", status: null, code: outcome.code, at },
          });
          report.blocked += 1;
          break;
        case "retry": {
          const attempts = operation.attempts + 1;
          await store.put({
            ...operation,
            attempts,
            nextAttemptAt: at + backoffMs(attempts, random, outcome.retryAfterMs),
            lastError: { kind: "retry", status: outcome.status, code: outcome.code, at },
          });
          halted.add(operation.sessionId);
          report.retrying += 1;
          break;
        }
        case "auth":
          await store.put({ ...operation, lastError: { kind: "auth", status: 401, at } });
          report.authRequired = true;
          return report;
        case "rejected":
          await store.remove(operation.id);
          await store.addRejection(
            {
              id: operation.id,
              accountId: operation.accountId,
              apiOrigin: operation.apiOrigin,
              sessionId: operation.sessionId,
              kind: operation.kind,
              status: outcome.status,
              code: outcome.code,
              at,
            },
            KEEP_REJECTIONS,
          );
          report.rejected += 1;
          report.rejections[operation.id] = { status: outcome.status, code: outcome.code };
          break;
      }
    }
    return report;
  }

  return {
    /** Persists an operation before any attempt. Re-enqueuing an id is a no-op. */
    async enqueue(
      input: Pick<OutboxOperation, "id" | "accountId" | "apiOrigin" | "sessionId" | "kind" | "path" | "body">,
    ) {
      if (await store.get(input.id)) return;
      const at = now();
      await store.put({ ...input, createdAt: at, attempts: 0, nextAttemptAt: at, state: "pending", lastError: null });
    },

    /** Delivers what is due for this account. Runs never overlap: a call made
     *  during a run starts after it, so anything enqueued before the call is
     *  attempted (unless its session must wait). */
    flush(scope: OutboxScope): Promise<FlushReport> {
      const run = tail.then(() => runFlush(scope));
      tail = run.catch(() => undefined);
      return run;
    },

    async status(scope: OutboxScope): Promise<OutboxStatus> {
      const all = await store.all();
      const mine = all.filter(inScope(scope));
      const pending = mine.filter((operation) => operation.state === "pending");
      const latest = [...mine].sort((a, b) => (b.lastError?.at ?? 0) - (a.lastError?.at ?? 0))[0];
      return {
        pending: pending.length,
        blocked: mine.length - pending.length,
        otherAccounts: all.length - mine.length,
        nextAttemptAt: pending.length ? Math.min(...pending.map((operation) => operation.nextAttemptAt)) : null,
        lastError: latest?.lastError ?? null,
        rejections: (await store.rejections()).filter((rejection) => rejection.accountId === scope.accountId && rejection.apiOrigin === scope.apiOrigin),
      };
    },

    /** The user freed capacity (or wants another try): retry blocked parts now. */
    async retryBlocked(scope: OutboxScope) {
      for (const operation of (await store.all()).filter(inScope(scope))) {
        if (operation.state === "blocked") await store.put({ ...operation, state: "pending", nextAttemptAt: now() });
      }
    },

    /** Observation batches of one session still waiting to be delivered. */
    async pendingObservations(sessionId: string) {
      return (await store.all()).filter((operation) => operation.sessionId === sessionId && operation.kind === "observations").length;
    },

    /** Soonest retry time across the scope, for scheduling a wake-up. */
    async nextAttemptAt(scope: OutboxScope) {
      const pending = (await store.all()).filter(inScope(scope)).filter((operation) => operation.state === "pending");
      return pending.length ? Math.min(...pending.map((operation) => operation.nextAttemptAt)) : null;
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;

/** In-memory store for tests and as a fallback when IndexedDB is unavailable. */
export function createMemoryOutboxStore(): OutboxStore {
  const operations = new Map<string, OutboxOperation>();
  let rejected: OutboxRejection[] = [];
  return {
    get: async (id) => operations.get(id),
    put: async (operation) => {
      operations.set(operation.id, structuredClone(operation));
    },
    remove: async (id) => {
      operations.delete(id);
    },
    all: async () => [...operations.values()].map((operation) => structuredClone(operation)),
    addRejection: async (rejection, keep) => {
      rejected = [...rejected, rejection].slice(-keep);
    },
    rejections: async () => [...rejected],
  };
}
