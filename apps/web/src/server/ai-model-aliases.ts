import type { AiProvider } from "@ankify/core";

/**
 * Retired provider model ids and the ids that replace them. DeepSeek retired
 * V4 Flash on 2026-09-10 and only temporarily routes `deepseek-v4-flash` to
 * V4.1 Flash (`deepseek-flash`); `deepseek-chat` / `deepseek-reasoner` were
 * discontinued on 2026-07-24. Stored settings and env values are normalized on
 * read so requests keep working after the old names stop routing.
 */
const MODEL_ALIASES: Partial<Record<Exclude<AiProvider, "">, Record<string, string>>> = {
  deepseek: {
    "deepseek-v4-flash": "deepseek-flash",
    "deepseek-chat": "deepseek-flash",
    "deepseek-reasoner": "deepseek-flash",
  },
};

export function normalizeModelId(provider: AiProvider, model: string): string {
  if (!provider) return model;
  return MODEL_ALIASES[provider]?.[model] ?? model;
}
