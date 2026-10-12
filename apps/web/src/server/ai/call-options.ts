import type { AiRuntimeSettings } from "../settings";
import { getReasoningLevels, normalizeReasoningLevel } from "@ankify/core";
import { getProvider } from "./providers/registry";
import type { ProviderOptions } from "./providers/types";

/**
 * How a call should reason:
 * - "user": the user's reasoning level for this model ("default" = provider
 *   default, thinking on).
 * - "lightest": the cheapest setting the model accepts, for probes and summaries.
 * - "capped": the user's level, but no heavier than the model's "low" (its
 *   lightest thinking level), for one-time writing that must finish within a
 *   turn: high thinking can take over a minute.
 */
export type CallReasoning = "user" | "lightest" | "capped";

/**
 * Provider-native call options for one AI call. Callers spread the result into
 * `generateText` / `ToolLoopAgent` and never branch on the provider themselves.
 * No sampling parameters are sent: thinking models ignore or reject them.
 */
export function aiCallOptions(
  settings: Pick<AiRuntimeSettings, "provider" | "model" | "reasoningLevel">,
  reasoning: CallReasoning,
): { providerOptions?: ProviderOptions } {
  const request =
    reasoning === "lightest"
      ? "lightest"
      : reasoning === "capped"
        ? cappedLevel(settings)
        : normalizeReasoningLevel(settings.provider, settings.model, settings.reasoningLevel);
  const providerOptions = getProvider(settings.provider).reasoningOptions(settings.model, request);
  return providerOptions ? { providerOptions } : {};
}

/** The user's level, capped at "low" (or the model's lightest level). The
 *  provider default counts as above the cap: it may think for long. */
function cappedLevel(settings: Pick<AiRuntimeSettings, "provider" | "model" | "reasoningLevel">): string {
  const level = normalizeReasoningLevel(settings.provider, settings.model, settings.reasoningLevel);
  const levels = getReasoningLevels(settings.provider, settings.model);
  if (levels.length === 0) return level;
  const cap = levels.includes("low") ? "low" : levels[0]!;
  if (level === "default") return cap;
  return levels.indexOf(level) <= levels.indexOf(cap) ? level : cap;
}
