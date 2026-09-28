import type { LanguageModel } from "ai";
import { getProvider } from "./ai/providers/registry";
import { getAiRuntimeSettings, type AiRuntimeSettings } from "./settings";

type BuildModelSettings = Pick<AiRuntimeSettings, "provider" | "model" | "apiKey">;

/**
 * Build a language model from resolved settings: the user's own encrypted key
 * when configured, otherwise the server's starter-credit key (see
 * starter-ai.ts). Callers starting new AI work spend a starter credit when
 * `settings.source` is "starter", and pass `aiCallOptions()` for per-call
 * provider options.
 */
export async function getActiveModel(userId: string): Promise<{ model: LanguageModel; settings: AiRuntimeSettings }> {
  const settings = await getAiRuntimeSettings(userId);
  return { model: buildModel(settings), settings };
}

export function buildModel(settings: BuildModelSettings): LanguageModel {
  return getProvider(settings.provider).createModel({ apiKey: settings.apiKey, model: settings.model });
}
