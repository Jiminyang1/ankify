import type {
  PracticeSessionStartResponseDto,
  SuggestionAllocateResponseDto,
  SuggestionDto,
  SuggestionListDto,
} from "@ankify/contracts";
import type { ApiClient, ApiResult } from "./api";

export type SuggestionsFailure = { ok: false; error: string };
export type SuggestionsOutcome<T> = { ok: true; response: T } | SuggestionsFailure;

/** Today's suggestions; `exhausted` when no new problem could be suggested. */
export type SuggestionsView = SuggestionListDto & { exhausted: boolean };

export type SuggestionActionResult = {
  suggestion: SuggestionDto;
  replacement: SuggestionDto | null;
  session: PracticeSessionStartResponseDto | null;
  idempotentReplay: boolean;
};

function failure(result: Extract<ApiResult<unknown>, { ok: false }>): SuggestionsFailure {
  if (result.kind === "auth") return { ok: false, error: "signed_out" };
  if (result.kind === "network") return { ok: false, error: "offline" };
  if (result.kind === "rate_limited") return { ok: false, error: result.code ?? "rate_limited" };
  if (result.kind === "server") return { ok: false, error: result.code ?? "server_error" };
  return { ok: false, error: result.code ?? "unexpected" };
}

/**
 * New-problem suggestions from the popup. Every call is an explicit, online
 * action with a visible result, so none goes through the durable outbox.
 */
export function createSuggestionsClient(deps: { api: ApiClient; newId: () => string }) {
  const { api } = deps;
  const list = () => api.request<SuggestionListDto>("/api/suggestions");
  const allocate = (kind: "daily" | "extra") =>
    api.request<SuggestionAllocateResponseDto>("/api/suggestions", { body: { requestId: deps.newId(), kind } });
  const act = (suggestionId: string, body: Record<string, unknown>) =>
    api.request<SuggestionActionResult>(`/api/suggestions/${encodeURIComponent(suggestionId)}/actions`, {
      body: { requestId: deps.newId(), ...body },
    });

  return {
    /** Today's suggestions, asking for the day's suggestion when it is missing. */
    async today(): Promise<SuggestionsOutcome<SuggestionsView>> {
      const current = await list();
      if (!current.ok) return failure(current);
      if (current.data.suggestions.some((suggestion) => suggestion.ordinal === 0)) return { ok: true, response: { ...current.data, exhausted: false } };
      const daily = await allocate("daily");
      if (!daily.ok) return failure(daily);
      if (!daily.data.suggestion) return { ok: true, response: { ...current.data, exhausted: true } };
      const refreshed = await list();
      return refreshed.ok ? { ok: true, response: { ...refreshed.data, exhausted: false } } : failure(refreshed);
    },
    /** One more suggestion; `null` when none is eligible. */
    async extra(): Promise<SuggestionsOutcome<SuggestionDto | null>> {
      const result = await allocate("extra");
      return result.ok ? { ok: true, response: result.data.suggestion } : failure(result);
    },
    async act(suggestionId: string, action: "skip" | "already_attempted"): Promise<SuggestionsOutcome<SuggestionActionResult>> {
      const result = await act(suggestionId, { action });
      return result.ok ? { ok: true, response: result.data } : failure(result);
    },
    /** Starts practice with a token the problem's tab uses to control the session. */
    async start(suggestionId: string, ownerToken: string): Promise<SuggestionsOutcome<SuggestionActionResult>> {
      const result = await act(suggestionId, { action: "start", ownerToken });
      return result.ok ? { ok: true, response: result.data } : failure(result);
    },
  };
}

export type SuggestionsClient = ReturnType<typeof createSuggestionsClient>;
