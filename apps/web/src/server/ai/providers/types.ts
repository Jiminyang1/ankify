import type { generateText, LanguageModel } from "ai";
import type { AiProvider } from "@ankify/core";

/** Provider-keyed options passed through to the SDK call (`providerOptions`). */
export type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]["providerOptions"]>;

export type ProviderId = Exclude<AiProvider, "">;

export type ModelEntry = { id: string; label?: string };

/**
 * How much the model should think on one call.
 * - "default": send nothing and let the provider decide. Current models
 *   reason adaptively by default, so this is the normal setting.
 * - "lightest": the cheapest, fastest setting this model accepts. Some models
 *   can turn thinking off; others (e.g. Claude Opus 5.5) only go down to a low
 *   effort. Used for connection probes and summaries.
 */
export type ReasoningRequest = "default" | "lightest";

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  /** Current model ids offered in the Settings UI, cheapest sensible default first. */
  presets: readonly string[];
  /** Retired model ids and their replacements. */
  aliases?: Readonly<Record<string, string>>;
  /**
   * Whether Settings shows the legacy Fast / Thinking switch for this provider.
   * "Fast" maps to the "lightest" reasoning request. Superseded by per-model
   * native reasoning levels.
   */
  legacyFastModeToggle: boolean;
  createModel(args: { apiKey: string; model: string }): LanguageModel;
  /** Provider-native options for one call. Returns undefined when nothing needs sending. */
  reasoningOptions(model: string, request: ReasoningRequest): ProviderOptions | undefined;
  listModels(apiKey: string, signal: AbortSignal): Promise<ModelEntry[]>;
}

/** A provider's model-list endpoint answered with a non-2xx status. */
export class ProviderHttpError extends Error {
  constructor(readonly status: number) {
    super(`provider_${status}`);
    this.name = "ProviderHttpError";
  }
}
