import type { AiRuntimeSettings } from "../settings";
import { getProvider } from "./providers/registry";
import type { ProviderOptions } from "./providers/types";

/**
 * How a call should reason:
 * - "user": the user's setting, which means the provider default (thinking on)
 *   unless they chose Fast on a provider that offers that switch.
 * - "lightest": the cheapest setting the model accepts, for probes and summaries.
 */
export type CallReasoning = "user" | "lightest";

/**
 * Provider-native call options for one AI call. Callers spread the result into
 * `generateText` / `ToolLoopAgent` and never branch on the provider themselves.
 * No sampling parameters are sent: thinking models ignore or reject them.
 */
export function aiCallOptions(
  settings: Pick<AiRuntimeSettings, "provider" | "model" | "reasoningMode">,
  reasoning: CallReasoning,
): { providerOptions?: ProviderOptions } {
  const provider = getProvider(settings.provider);
  const request =
    reasoning === "lightest" || (provider.legacyFastModeToggle && settings.reasoningMode === "fast")
      ? "lightest"
      : "default";
  const providerOptions = provider.reasoningOptions(settings.model, request);
  return providerOptions ? { providerOptions } : {};
}
