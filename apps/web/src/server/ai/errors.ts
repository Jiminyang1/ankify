import { APICallError } from "ai";
import { isAiTimeoutError } from "../ai-errors";
import { ProviderHttpError } from "./providers/types";

/**
 * One classification for every provider failure, shared by generation jobs,
 * Study Coach, the connection probe, and model listing. Based on HTTP status,
 * so every provider reads the same; message text is only consulted for the
 * unknown-model 400 some providers send instead of a 404.
 */
export type ProviderFailure =
  | "invalid_api_key"
  | "forbidden"
  | "model_not_found"
  | "quota_exceeded"
  | "rate_limited"
  | "provider_unavailable"
  | "bad_request"
  | "timeout"
  | "network"
  | "unknown";

export function providerStatus(error: unknown): number | null {
  if (APICallError.isInstance(error)) return error.statusCode ?? null;
  if (error instanceof ProviderHttpError) return error.status;
  const details = error as { status?: unknown; statusCode?: unknown } | null;
  if (typeof details?.status === "number") return details.status;
  if (typeof details?.statusCode === "number") return details.statusCode;
  return null;
}

export function classifyProviderFailure(error: unknown): ProviderFailure {
  if (isAiTimeoutError(error)) return "timeout";
  const status = providerStatus(error);
  if (status === 401) return "invalid_api_key";
  if (status === 402) return "quota_exceeded";
  if (status === 403) return "forbidden";
  if (status === 404) return "model_not_found";
  if (status === 429) return "rate_limited";
  if (status !== null && status >= 500) return "provider_unavailable";
  if (status === 400) return isUnknownModelMessage(error) ? "model_not_found" : "bad_request";
  if (status === null && isNetworkError(error)) return "network";
  return "unknown";
}

/** Failures worth retrying later without any change from the user. */
export function isTransientProviderFailure(failure: ProviderFailure) {
  return (
    failure === "rate_limited" ||
    failure === "provider_unavailable" ||
    failure === "timeout" ||
    failure === "network"
  );
}

// Some providers answer an unknown model id with 400, not 404. DeepSeek says
// "The supported API model names are …, but you passed …".
function isUnknownModelMessage(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (!message.includes("model")) return false;
  return (
    message.includes("not exist") ||
    message.includes("not found") ||
    message.includes("supported api model names")
  );
}

function isNetworkError(error: unknown) {
  if (APICallError.isInstance(error)) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET"
  );
}
