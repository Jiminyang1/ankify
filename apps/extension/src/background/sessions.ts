import type {
  LeetcodeAvailability,
  PracticeModeId,
  PracticeProblemInput,
  PracticeProblemStatusDto,
  PracticeSessionCommandResponseDto,
  PracticeSessionCurrentDto,
  PracticeSessionDto,
  PracticeSessionErrorCode,
  PracticeSessionRatingResponseDto,
  PracticeSessionStartResponseDto,
  PracticeSessionSubmissionsResponseDto,
  ReviewOverviewDto,
  SessionBaselineInput,
  SessionObservationInput,
} from "@ankify/contracts";
import type { SessionControl } from "../shared/protocol";
import type { AccountStateApi } from "./account";
import type { ApiClient, ApiResult } from "./api";
import type { Outbox, OutboxKind } from "./outbox";

/** Per-tab owner tokens. A tab keeps its token across reloads; the popup has its own. */
export type TokenRegistry = {
  tokenFor(tabId: number): Promise<string>;
  peek(tabId: number): Promise<string | null>;
  popupToken(): Promise<string>;
};

/** Cumulative activity per session and owner token, reported in heartbeats. */
export type ActivityTotals = {
  add(sessionId: string, token: string, delta: { activeMs: number; observedMs: number }): Promise<{ activeMs: number; observedMs: number }>;
};

export type Failure = {
  ok: false;
  error: PracticeSessionErrorCode | "signed_out" | "offline" | "rate_limited" | "server_error" | "unexpected";
  session?: PracticeSessionDto;
  problem?: PracticeProblemStatusDto;
};

export type Outcome<T> = { ok: true; response: T } | Failure;
/** Durable operations may be accepted before the server confirms them. */
export type DurableOutcome<T> = { ok: true; response: T; queued: false } | { ok: true; queued: true } | Failure;

function failure<T>(result: Extract<ApiResult<T>, { ok: false }>): Failure {
  const body = result.body as { session?: PracticeSessionDto; problem?: PracticeProblemStatusDto } | undefined;
  switch (result.kind) {
    case "auth":
      return { ok: false, error: "signed_out" };
    case "network":
      return { ok: false, error: "offline" };
    case "rate_limited":
      return { ok: false, error: "rate_limited" };
    case "server":
      return { ok: false, error: "server_error" };
    case "rejected":
      return {
        ok: false,
        error: (result.code as PracticeSessionErrorCode | undefined) ?? "unexpected",
        ...(body?.session ? { session: body.session } : {}),
        ...(body?.problem ? { problem: body.problem } : {}),
      };
  }
}

const sessionPath = (sessionId: string, suffix: "commands" | "submissions" | "rating") =>
  `/api/practice-sessions/${encodeURIComponent(sessionId)}/${suffix}`;

/**
 * The only place that speaks the session API. It attaches the sending tab's
 * owner token (never exposed to content scripts), requires the server to
 * acknowledge a start, and routes everything that must survive an outage
 * (finish, abandon, ratings, observations) through the durable outbox.
 */
export function createSessionController(deps: {
  api: ApiClient;
  outbox: Outbox;
  account: AccountStateApi;
  tokens: TokenRegistry;
  totals: ActivityTotals;
  newId: () => string;
  /** Saved operations were delivered by a flush (not by the request that made them). */
  onDelivered?: () => void;
}) {
  const { api, outbox, account, tokens } = deps;

  async function flushScope(target: { accountId: string; apiOrigin: string }) {
    const report = await outbox.flush(target);
    if (report.authRequired) account.invalidate();
    if (report.delivered > 0) deps.onDelivered?.();
    return report;
  }

  let resuming: ReturnType<typeof resume> | null = null;
  async function resume() {
    if (!(await outbox.hasPending())) return null;
    const target = await scope();
    if (!target) return null;
    await outbox.retryNow(target);
    return flushScope(target);
  }

  /** ankify answered: send what waits now rather than at its backoff time
   *  (or Chrome's 30-second minimum alarm). */
  function resumeSync() {
    resuming ??= resume().finally(() => {
      resuming = null;
    });
    return resuming;
  }

  async function scope() {
    const accountId = await account.scopeAccountId();
    return accountId ? { accountId, apiOrigin: api.origin } : null;
  }

  /** Persists, then attempts delivery once; reports the server's answer when there is one. */
  async function durable<T>(sessionId: string, kind: OutboxKind, id: string, path: string, body: unknown): Promise<DurableOutcome<T>> {
    const target = await scope();
    if (!target) return { ok: false, error: "signed_out" };
    await outbox.enqueue({ id, ...target, sessionId, kind, path, body });
    const report = await outbox.flush(target);
    if (report.authRequired) account.invalidate();
    if (id in report.responses) return { ok: true, response: report.responses[id] as T, queued: false };
    const rejected = report.rejections[id];
    if (rejected) return { ok: false, error: (rejected.code as PracticeSessionErrorCode | null) ?? "unexpected" };
    return { ok: true, queued: true };
  }

  async function control(ownerToken: string, sessionId: string, input: SessionControl): Promise<DurableOutcome<PracticeSessionCommandResponseDto>> {
    const requestId = deps.newId();
    const command = { ...input, type: input.command, requestId, ownerToken } as Record<string, unknown>;
    delete command.command;
    if (input.command === "finish" || input.command === "abandon") {
      return durable(sessionId, "command", requestId, sessionPath(sessionId, "commands"), command);
    }
    // Resume, takeover, and baseline decide who controls the session now: they
    // need an answer, so they are never queued.
    const result = await api.request<PracticeSessionCommandResponseDto>(sessionPath(sessionId, "commands"), { body: command });
    return result.ok ? { ok: true, response: result.data, queued: false } : failure(result);
  }

  return {
    /** The page's problem and session, plus how many of the session's
     *  observations still wait in the outbox (the server cannot know those). */
    async pageState(tabId: number, slug: string): Promise<Outcome<PracticeSessionCurrentDto & { localSync: { pendingObservations: number } }>> {
      const ownerToken = await tokens.tokenFor(tabId);
      const result = await api.request<PracticeSessionCurrentDto>(
        `/api/practice-sessions/current?slug=${encodeURIComponent(slug)}`,
        { ownerToken },
      );
      if (!result.ok && result.kind === "auth") account.invalidate();
      if (!result.ok) return failure(result);
      void resumeSync().catch(() => undefined);
      const pendingObservations = result.data.session ? await outbox.pendingObservations(result.data.session.id) : 0;
      return { ok: true, response: { ...result.data, localSync: { pendingObservations } } };
    },

    /** Starting needs the server's acknowledgment; it is never queued. A
     *  session started before its tab exists carries a pre-minted token that
     *  is bound to the tab once it opens. */
    async start(
      origin: { tabId: number } | { ownerToken: string },
      input: {
        target: { kind: "problem"; problemId: string } | { kind: "leetcode"; problem: PracticeProblemInput };
        mode: PracticeModeId;
        baseline?: SessionBaselineInput;
        sourceAccount?: string;
        supersedePendingRating: boolean;
      },
    ): Promise<Outcome<PracticeSessionStartResponseDto>> {
      const ownerToken = "tabId" in origin ? await tokens.tokenFor(origin.tabId) : origin.ownerToken;
      const result = await api.request<PracticeSessionStartResponseDto>("/api/practice-sessions", {
        body: { requestId: deps.newId(), ownerToken, ...input },
      });
      if (!result.ok && result.kind === "auth") account.invalidate();
      return result.ok ? { ok: true, response: result.data } : failure(result);
    },

    /** From a tab, with its token; from the popup (no tab), with the popup's. */
    async control(origin: { tabId: number } | { popup: true }, sessionId: string, input: SessionControl) {
      const ownerToken = "tabId" in origin ? await tokens.tokenFor(origin.tabId) : await tokens.popupToken();
      return control(ownerToken, sessionId, input);
    },

    /** Adds a tab's activity to its cumulative totals and renews its lease. */
    async activity(
      tabId: number,
      sessionId: string,
      delta: { activeMs: number; observedMs: number },
      availability: LeetcodeAvailability,
    ): Promise<Outcome<PracticeSessionCommandResponseDto>> {
      const ownerToken = await tokens.peek(tabId);
      if (!ownerToken) return { ok: false, error: "not_owner" };
      const totals = await deps.totals.add(sessionId, ownerToken, delta);
      const result = await api.request<PracticeSessionCommandResponseDto>(sessionPath(sessionId, "commands"), {
        body: { type: "heartbeat", ownerToken, activeMs: totals.activeMs, observedMs: totals.observedMs, availability },
      });
      if (!result.ok) return failure(result);
      void resumeSync().catch(() => undefined);
      return { ok: true, response: result.data };
    },

    observations(sessionId: string, observations: SessionObservationInput[]) {
      return durable<PracticeSessionSubmissionsResponseDto>(sessionId, "observations", deps.newId(), sessionPath(sessionId, "submissions"), { observations });
    },

    rate(sessionId: string, rating: 1 | 2 | 3 | 4) {
      const requestId = deps.newId();
      return durable<PracticeSessionRatingResponseDto>(sessionId, "rating", requestId, sessionPath(sessionId, "rating"), { requestId, rating });
    },

    /** Skips the rating; the schedule stays as it is. */
    skipRating(sessionId: string) {
      const requestId = deps.newId();
      return durable<PracticeSessionCommandResponseDto>(sessionId, "command", requestId, sessionPath(sessionId, "commands"), { type: "dismiss_rating", requestId });
    },

    async overview(): Promise<Outcome<ReviewOverviewDto>> {
      const result = await api.request<ReviewOverviewDto>("/api/review/overview?limit=20");
      if (!result.ok && result.kind === "auth") account.invalidate();
      return result.ok ? { ok: true, response: result.data } : failure(result);
    },

    /** Delivers whatever is due; called on a timer and on startup. */
    async flush() {
      const target = await scope();
      return target ? flushScope(target) : null;
    },

    resumeSync,

    async syncStatus() {
      const target = await scope();
      return target ? outbox.status(target) : null;
    },

    async retryBlocked() {
      const target = await scope();
      if (target) await outbox.retryBlocked(target);
    },
  };
}

export type SessionController = ReturnType<typeof createSessionController>;
