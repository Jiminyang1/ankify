import type { MistakeRecordDto, PublicAiJobDto, SessionAnalysisStateDto, SkillDimensionId } from "@ankify/contracts";
import type { ApiClient, ApiResult } from "./api";

export type AnalysisFailure = { ok: false; error: string };
export type AnalysisOutcome<T> = { ok: true; response: T } | AnalysisFailure;

function failure(result: Extract<ApiResult<unknown>, { ok: false }>): AnalysisFailure {
  if (result.kind === "auth") return { ok: false, error: "signed_out" };
  if (result.kind === "network") return { ok: false, error: "offline" };
  if (result.kind === "rate_limited") return { ok: false, error: result.code ?? "rate_limited" };
  if (result.kind === "server") return { ok: false, error: result.code ?? "server_error" };
  return { ok: false, error: result.code ?? "unexpected" };
}

/**
 * Session analysis from the extension. These are explicit, online actions
 * with visible results, so they never go through the durable outbox.
 */
export function createAnalysisClient(deps: { api: ApiClient; newId: () => string }) {
  const { api } = deps;
  return {
    async state(sessionId: string): Promise<AnalysisOutcome<SessionAnalysisStateDto>> {
      const result = await api.request<SessionAnalysisStateDto>(`/api/practice-sessions/${encodeURIComponent(sessionId)}/analysis`);
      return result.ok ? { ok: true, response: result.data } : failure(result);
    },
    async start(sessionId: string): Promise<AnalysisOutcome<PublicAiJobDto>> {
      const result = await api.request<{ job: PublicAiJobDto }>("/api/ai-jobs", {
        body: { action: "session_analyze", practiceSessionId: sessionId, requestId: deps.newId() },
      });
      return result.ok ? { ok: true, response: result.data.job } : failure(result);
    },
    async decide(mistakeId: string, decision: "confirm" | "dismiss", category?: SkillDimensionId): Promise<AnalysisOutcome<MistakeRecordDto>> {
      const result = await api.request<{ mistake: MistakeRecordDto }>(`/api/mistakes/${encodeURIComponent(mistakeId)}`, {
        method: "PATCH",
        body: decision === "confirm" ? { status: "confirmed", ...(category ? { primaryCategory: category } : {}) } : { status: "dismissed" },
      });
      return result.ok ? { ok: true, response: result.data.mistake } : failure(result);
    },
  };
}

export type AnalysisClient = ReturnType<typeof createAnalysisClient>;
