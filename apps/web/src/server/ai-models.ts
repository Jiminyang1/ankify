import type { AiProvider } from "@ankify/core";
import { safeErrorForLog } from "@/server/ai-errors";
import { decryptSecret } from "@/server/secret-box";
import { getAiSettings } from "@/server/settings";

const MODEL_LIST_TIMEOUT_MS = 15_000;

type ModelProvider = Exclude<AiProvider, "">;

type ModelEntry = {
  id: string;
  label?: string;
};

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
    const models = await listModels(input.provider, apiKey, controller.signal);
    return { ok: true, provider: input.provider, models };
  } catch (error) {
    console.warn("[ai-models] provider request failed", safeErrorForLog(error));
    return { ok: false, ...classifyListError(error) };
  } finally {
    clearTimeout(timer);
  }
}

function listModels(provider: ModelProvider, apiKey: string, signal: AbortSignal) {
  switch (provider) {
    case "anthropic":
      return listAnthropic(apiKey, signal);
    case "openai":
      return listOpenAi(apiKey, signal);
    case "deepseek":
      return listDeepseek(apiKey, signal);
  }
}

async function listAnthropic(apiKey: string, signal: AbortSignal): Promise<ModelEntry[]> {
  const response = await fetch("https://api.anthropic.com/v1/models?limit=1000", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal,
  });
  if (!response.ok) throw new ProviderError(response.status);

  const json = (await response.json()) as {
    data?: Array<{ id: string; display_name?: string }>;
  };
  const models = (json.data ?? [])
    .map((model) => ({ id: model.id, label: model.display_name }))
    .filter((model) => model.id.startsWith("claude-"));
  models.sort((a, b) => b.id.localeCompare(a.id));
  return models;
}

async function listOpenAi(apiKey: string, signal: AbortSignal): Promise<ModelEntry[]> {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!response.ok) throw new ProviderError(response.status);

  const json = (await response.json()) as { data?: Array<{ id: string }> };
  const models = (json.data ?? [])
    .map((model) => ({ id: model.id }))
    .filter((model) => isOpenAiChatModel(model.id));
  models.sort((a, b) => b.id.localeCompare(a.id));
  return models;
}

async function listDeepseek(apiKey: string, signal: AbortSignal): Promise<ModelEntry[]> {
  const response = await fetch("https://api.deepseek.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!response.ok) throw new ProviderError(response.status);

  const json = (await response.json()) as { data?: Array<{ id: string }> };
  const models = (json.data ?? []).map((model) => ({ id: model.id }));
  models.sort((a, b) => b.id.localeCompare(a.id));
  return models;
}

function isOpenAiChatModel(id: string) {
  const lower = id.toLowerCase();
  const blocklist = [
    "embed",
    "whisper",
    "tts",
    "dall-e",
    "moderation",
    "audio",
    "realtime",
    "image",
    "transcribe",
    "babbage",
    "davinci-edit",
    "instruct",
    "search",
  ];
  if (blocklist.some((keyword) => lower.includes(keyword))) return false;
  return lower.startsWith("gpt-") || lower.startsWith("chatgpt") || /^o\d/.test(lower);
}

class ProviderError extends Error {
  constructor(readonly status: number) {
    super(`provider_${status}`);
  }
}

function classifyListError(error: unknown): { code: string; message: string } {
  if (error instanceof ProviderError) {
    if (error.status === 401) {
      return { code: "invalid_api_key", message: "API key was rejected by the provider." };
    }
    if (error.status === 403) {
      return { code: "forbidden", message: "API key cannot list models." };
    }
    if (error.status === 429) {
      return { code: "quota_or_rate_limit", message: "Provider returned a rate limit error." };
    }
    return {
      code: `http_${error.status}`,
      message: `Provider returned HTTP ${error.status}.`,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.toLowerCase().includes("aborted")) {
    return {
      code: "timeout",
      message: `Provider did not respond within ${MODEL_LIST_TIMEOUT_MS / 1000} seconds.`,
    };
  }
  return { code: "network", message: "Could not reach the provider." };
}
