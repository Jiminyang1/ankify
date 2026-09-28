import { safeErrorForLog } from "@/server/ai-errors";
import { classifyProviderFailure, providerStatus } from "@/server/ai/errors";
import { getProvider } from "@/server/ai/providers/registry";
import type { ModelEntry, ProviderId } from "@/server/ai/providers/types";
import { decryptSecret } from "@/server/secret-box";
import { getAiSettings } from "@/server/settings";

const MODEL_LIST_TIMEOUT_MS = 15_000;

type ModelProvider = ProviderId;

type AvailableAiModelsResult =
  | { ok: true; provider: ModelProvider; models: ModelEntry[] }
  | { ok: false; code: string; message: string }
  | { error: "missing_api_key" };

export async function listAvailableAiModels(
  userId: string,
  input: { provider: ModelProvider; apiKey?: string },
): Promise<AvailableAiModelsResult> {
  let apiKey = input.apiKey;
  if (!apiKey) {
    const stored = await getAiSettings(userId);
    if (stored.encryptedApiKey) {
      try {
        apiKey = decryptSecret(stored.encryptedApiKey);
      } catch {
        // Invalid stored envelopes are handled as a missing key.
      }
    }
  }
  if (!apiKey) return { error: "missing_api_key" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS);
  try {
    const models = await getProvider(input.provider).listModels(apiKey, controller.signal);
    return { ok: true, provider: input.provider, models };
  } catch (error) {
    console.warn("[ai-models] provider request failed", safeErrorForLog(error));
    return { ok: false, ...classifyListError(error) };
  } finally {
    clearTimeout(timer);
  }
}

function classifyListError(error: unknown): { code: string; message: string } {
  switch (classifyProviderFailure(error)) {
    case "invalid_api_key":
      return { code: "invalid_api_key", message: "API key was rejected by the provider." };
    case "forbidden":
      return { code: "forbidden", message: "API key cannot list models." };
    case "rate_limited":
    case "quota_exceeded":
      return { code: "quota_or_rate_limit", message: "Provider returned a rate limit error." };
    case "timeout":
      return {
        code: "timeout",
        message: `Provider did not respond within ${MODEL_LIST_TIMEOUT_MS / 1000} seconds.`,
      };
    case "network":
      return { code: "network", message: "Could not reach the provider." };
    default: {
      const status = providerStatus(error);
      return status === null
        ? { code: "network", message: "Could not reach the provider." }
        : { code: `http_${status}`, message: `Provider returned HTTP ${status}.` };
    }
  }
}
