import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { ProviderHttpError, type ProviderAdapter } from "./types";

/**
 * DeepSeek through its OpenAI-compatible API.
 *
 * Thinking is on by default (effort `high`) and is the only provider here that
 * can be switched fully off: `thinking: { type: "disabled" }`. The SDK spreads
 * `providerOptions.deepseek` into the request body. Sampling parameters are
 * ignored while thinking, so callers never send them.
 * Docs: https://api-docs.deepseek.com/guides/thinking_mode
 */
export const deepseekProvider: ProviderAdapter = {
  id: "deepseek",
  label: "DeepSeek",
  // V4 Flash was retired on 2026-09-10 and its id only temporarily routes to
  // V4.1 Flash; `deepseek-chat` / `deepseek-reasoner` ended on 2026-07-24.
  aliases: {
    "deepseek-v4-flash": "deepseek-flash",
    "deepseek-chat": "deepseek-flash",
    "deepseek-reasoner": "deepseek-flash",
  },
  legacyFastLevel: "off",

  createModel({ apiKey, model }) {
    const client = createOpenAICompatible({
      name: "deepseek",
      baseURL: "https://api.deepseek.com/v1",
      apiKey,
    });
    return client(model);
  },

  reasoningOptions(_model, request) {
    if (request === "default") return undefined;
    if (request === "lightest" || request === "off") return { deepseek: { thinking: { type: "disabled" } } };
    // Native effort: low | high | max.
    return { deepseek: { thinking: { type: "enabled" }, reasoningEffort: request } };
  },

  async listModels(apiKey, signal) {
    const response = await fetch("https://api.deepseek.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!response.ok) throw new ProviderHttpError(response.status);
    const json = (await response.json()) as { data?: Array<{ id: string }> };
    return (json.data ?? []).map((model) => ({ id: model.id })).sort((a, b) => b.id.localeCompare(a.id));
  },
};
