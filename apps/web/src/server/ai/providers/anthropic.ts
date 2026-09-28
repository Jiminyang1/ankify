import { createAnthropic } from "@ai-sdk/anthropic";
import { ProviderHttpError, type ProviderAdapter, type ProviderOptions } from "./types";

/**
 * Anthropic Claude.
 *
 * Current models think adaptively by default, and how thinking can be reduced
 * differs by generation:
 * - Opus 5.5, Fable 5.x, Mythos, Sonnet 5.5: thinking can't be disabled
 *   (`thinking: disabled` is a 400); lower `effort` instead.
 * - Opus 5, Opus 4.6-4.8, Sonnet 5, Sonnet 4.6: `thinking: disabled` is accepted.
 * - Haiku 4.5 and older: no thinking unless requested, so nothing to send.
 * Opus 4.7+ and Sonnet 5+ also reject sampling parameters, so callers never
 * send temperature/top_p.
 */
const EFFORT_ONLY = /^claude-(opus-5-5|fable-5|mythos-5|sonnet-5-5)/;
const CAN_DISABLE = /^claude-(opus-5(?!-5)|opus-4-[678]|sonnet-5(?!-5)|sonnet-4-6)/;

export const anthropicProvider: ProviderAdapter = {
  id: "anthropic",
  label: "Anthropic",
  presets: ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5-20251001"],
  legacyFastModeToggle: false,

  createModel({ apiKey, model }) {
    return createAnthropic({ apiKey })(model);
  },

  reasoningOptions(model, request): ProviderOptions | undefined {
    if (request !== "lightest") return undefined;
    if (EFFORT_ONLY.test(model)) return { anthropic: { effort: "low" } };
    if (CAN_DISABLE.test(model)) return { anthropic: { thinking: { type: "disabled" } } };
    return undefined;
  },

  async listModels(apiKey, signal) {
    const response = await fetch("https://api.anthropic.com/v1/models?limit=1000", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal,
    });
    if (!response.ok) throw new ProviderHttpError(response.status);
    const json = (await response.json()) as { data?: Array<{ id: string; display_name?: string }> };
    return (json.data ?? [])
      .map((model) => ({ id: model.id, label: model.display_name }))
      .filter((model) => model.id.startsWith("claude-"))
      .sort((a, b) => b.id.localeCompare(a.id));
  },
};
