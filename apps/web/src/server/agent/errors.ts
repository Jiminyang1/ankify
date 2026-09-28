import { isAiTimeoutError, safeErrorForLog } from "../ai-errors";
import { classifyProviderFailure } from "../ai/errors";

export function classifyAgentError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { code: "agent_interrupted", message: "The Study Coach response was interrupted." };
  }
  if (isAiTimeoutError(error)) {
    return { code: "agent_timeout", message: "The Study Coach timed out. Try again." };
  }
  const failure = classifyProviderFailure(error);
  if (failure === "rate_limited") {
    return { code: "provider_rate_limited", message: "The AI provider is rate limited. Try again shortly." };
  }
  if (failure === "provider_unavailable") {
    return { code: "provider_unavailable", message: "The AI provider is temporarily unavailable." };
  }
  return { code: "agent_failed", message: "The Study Coach could not finish this response." };
}

export function logAgentError(runId: string, error: unknown) {
  console.error("[agent] run failed", { runId, ...safeErrorForLog(error) });
}
