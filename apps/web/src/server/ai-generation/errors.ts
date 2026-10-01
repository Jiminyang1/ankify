import { isAiTimeoutError, safeErrorForLog } from "../ai-errors";

class AiJobExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    /** The provider's Retry-After, when it sent one. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "AiJobExecutionError";
  }
}

/** Provider errors that mean the key itself is wrong, whatever the transport reported. */
const AUTH_ERROR = /invalid[ _-]?api[ _-]?key|incorrect api key|unauthori[sz]ed|authentication|api key not valid|permission denied|LoadAPIKeyError/i;

/** A 429 that is an empty account (no credit or quota), not a rate limit: waiting does not help. */
const QUOTA_EXHAUSTED = /insufficient_quota|credit_balance|billing_hard_limit|exceeded your current quota/i;

function retryAfterSeconds(error: unknown) {
  const headers = (error as { responseHeaders?: Record<string, string> } | null)?.responseHeaders;
  const value = Number(headers?.["retry-after"] ?? headers?.["Retry-After"]);
  return Number.isFinite(value) && value > 0 ? Math.min(600, Math.ceil(value)) : null;
}

/** A failure that retrying the same job cannot fix (the job fails at once). */
export function nonRetryableJobError(code: string, message: string) {
  return new AiJobExecutionError(code, message, false);
}

export function classifyAiJobError(error: unknown): AiJobExecutionError {
  if (error instanceof AiJobExecutionError) return error;
  if (isAiTimeoutError(error)) {
    return new AiJobExecutionError("ai_timeout", "AI generation timed out.", true);
  }

  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("AI_NOT_CONFIGURED")) {
    return new AiJobExecutionError(
      "ai_not_configured",
      "Configure an AI provider and model in Settings.",
      false,
    );
  }
  if (message.startsWith("AI_KEY_MISSING")) {
    return new AiJobExecutionError(
      "ai_key_missing",
      "Add your provider API key in Settings.",
      false,
    );
  }
  if (
    message === "problem_not_found" ||
    message === "card_limit_reached" ||
    message === "quiz_session_limit_reached"
  ) {
    return new AiJobExecutionError(message, message.replaceAll("_", " "), false);
  }
  if (
    message === "ai_configuration_changed"
  ) {
    return new AiJobExecutionError(message, message.replaceAll("_", " "), false);
  }
  if (
    message.startsWith("quiz_correct_answer_not_in_choices") ||
    message === "quiz_scope_coverage_failed"
  ) {
    return new AiJobExecutionError("ai_output_invalid", "AI returned an invalid quiz. Retrying.", true);
  }

  const details = error as Error & { status?: unknown; statusCode?: unknown; code?: unknown };
  const status = typeof details.status === "number"
    ? details.status
    : typeof details.statusCode === "number"
      ? details.statusCode
      : null;
  if (status === 401 || status === 403 || (status === null && AUTH_ERROR.test(`${(error as Error | null)?.name ?? ""} ${message}`))) {
    // A wrong or revoked key never fixes itself: fail at once, never retry.
    return new AiJobExecutionError("ai_request_rejected", "AI provider rejected the key. Check it in Settings.", false);
  }
  if (status === 429 && QUOTA_EXHAUSTED.test(`${message} ${(error as { responseBody?: unknown } | null)?.responseBody ?? ""}`)) {
    return new AiJobExecutionError("ai_quota_exceeded", "Your AI provider account has no credit or quota left.", false);
  }
  if (status === 429 || (status !== null && status >= 500)) {
    return new AiJobExecutionError("ai_provider_unavailable", "AI provider is temporarily unavailable.", true, retryAfterSeconds(error));
  }
  if (status !== null && status >= 400) {
    return new AiJobExecutionError(
      "ai_request_rejected",
      "AI provider rejected the generation request.",
      false,
    );
  }

  return new AiJobExecutionError("ai_generation_failed", "AI generation failed. Try again.", true);
}

export function logAiJobError(jobId: string, error: unknown) {
  console.error("[ai-job] failed", { jobId, ...safeErrorForLog(error) });
}
