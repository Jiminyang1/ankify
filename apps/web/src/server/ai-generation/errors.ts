import { isAiTimeoutError, safeErrorForLog } from "../ai-errors";

class AiJobExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AiJobExecutionError";
  }
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
  if (status === 429 || (status !== null && status >= 500)) {
    return new AiJobExecutionError("ai_provider_unavailable", "AI provider is temporarily unavailable.", true);
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
