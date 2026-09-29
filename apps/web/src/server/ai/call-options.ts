import type { AiRuntimeSettings } from "../settings";
import { normalizeReasoningLevel } from "@ankify/core";
import { getProvider } from "./providers/registry";
import type { ProviderOptions } from "./providers/types";

/**
 * How a call should reason:
 * - "user": the user's reasoning level for this model ("default" = provider
 *   default, thinking on).
 * - "lightest": the cheapest setting the model accepts, for probes and summaries.
 */
export type CallReasoning = "user" | "lightest";

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
      : normalizeReasoningLevel(settings.provider, settings.model, settings.reasoningLevel);
  const providerOptions = getProvider(settings.provider).reasoningOptions(settings.model, request);
  return providerOptions ? { providerOptions } : {};
}
