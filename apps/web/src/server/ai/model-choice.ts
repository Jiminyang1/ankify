import { DEFAULT_REASONING_LEVEL, getAiProviderInfo, getReasoningLevels, normalizeReasoningLevel } from "@ankify/core";
import type { AgentModelChoice, CoachModelsDto } from "@ankify/contracts";
import { normalizeModelId } from "./providers/registry";
import type { AiRuntimeSettings } from "../settings";

/**
 * A per-turn model pick from the Coach's picker. It only applies to the user's
 * own key and stays on that key's provider: the starter key's model is fixed,
 * and a key is never sent to another provider. The level is checked against
 * the model ("default" when it doesn't accept it).
 */
export function applyModelChoice(settings: AiRuntimeSettings, choice: AgentModelChoice | undefined): AiRuntimeSettings {
  if (!choice || settings.source !== "user") return settings;
  const model = normalizeModelId(settings.provider, choice.id);
  const level = choice.reasoningLevel ?? (model === settings.model ? settings.reasoningLevel : DEFAULT_REASONING_LEVEL);
  return { ...settings, model, reasoningLevel: normalizeReasoningLevel(settings.provider, model, level) };
}

/** The models the picker offers: the provider's suggested models plus the one in Settings. */
export function coachModels(settings: AiRuntimeSettings): CoachModelsDto {
  const base = {
    source: settings.source,
    provider: settings.provider,
    defaultModel: settings.model,
    defaultReasoningLevel: settings.reasoningLevel,
  };
  if (settings.source !== "user") return { ...base, models: [] };
  const suggested = getAiProviderInfo(settings.provider)?.models ?? [];
  const ids = [settings.model, ...suggested.map((model) => model.id).filter((id) => id !== settings.model)];
  return {
    ...base,
    models: ids.map((id) => ({ id, reasoningLevels: [...getReasoningLevels(settings.provider, id)] })),
  };
}
