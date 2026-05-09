import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV1 } from "ai";
import { getAiRuntimeSettings, type AiRuntimeSettings } from "./settings";

/**
 * Force-disable DeepSeek V4 thinking mode by injecting
 * `thinking: { type: "disabled" }` into every request body. Used only for
 * latency-sensitive probes and Fast mode where reasoning would waste tokens
 * and time. Thinking mode leaves DeepSeek's default thinking behavior on.
 * Has no effect on legacy `deepseek-chat`; `deepseek-reasoner` ignores the
 * field.
 */
const deepseekNonThinkingFetch: typeof fetch = async (input, init) => {
  if (init?.body && typeof init.body === "string") {
    try {
      const body = JSON.parse(init.body);
      if (body && typeof body === "object" && !("thinking" in body)) {
        body.thinking = { type: "disabled" };
        init = { ...init, body: JSON.stringify(body) };
      }
    } catch {
      // body wasn't JSON; pass through untouched
    }
  }
  return fetch(input, init);
};

/** OpenAI-compatible providers we ship as known presets. The "preset" is just
 *  a baseURL + a few opt-in quirks (e.g. DeepSeek's non-standard `thinking`
 *  field). Adding a new openai-compatible endpoint (Gemini, Groq, Together,
 *  OpenRouter, local Ollama …) is one entry here. */
const OPENAI_COMPATIBLE_PRESETS: Record<
  "deepseek",
  { name: string; baseURL: string; supportsThinkingToggle: boolean }
> = {
  deepseek: {
    name: "deepseek",
    baseURL: "https://api.deepseek.com/v1",
    supportsThinkingToggle: true,
  },
};

export interface BuildModelOptions {
  /** If true and the provider supports a thinking-toggle, force-disable
   *  thinking for this client (probes, latency-sensitive paths). */
  disableThinking?: boolean;
}

type BuildModelSettings = Omit<AiRuntimeSettings, "reasoningMode"> & {
  reasoningMode?: AiRuntimeSettings["reasoningMode"];
};

/**
 * Build a LanguageModelV1 from the current provider settings. The active provider
 * is chosen in the dashboard; the API key is the current user's encrypted key
 * from settings. Server provider env keys are intentionally not used.
 */
export async function getActiveModel(userId: string, opts: BuildModelOptions = {}): Promise<{ model: LanguageModelV1; settings: AiRuntimeSettings }> {
  const settings = await getAiRuntimeSettings(userId);
  return { model: buildModel(settings, opts), settings };
}

export function buildModel(settings: BuildModelSettings, opts: BuildModelOptions = {}): LanguageModelV1 {
  if (settings.provider === "anthropic") {
    const client = createAnthropic({ apiKey: settings.apiKey });
    return client(settings.model);
  }
  if (settings.provider === "openai") {
    // Native OpenAI client — opt into provider-specific niceties (strict tool
    // use, response_format=json_schema, etc.) that the generic compat client
    // doesn't expose.
    const client = createOpenAI({ apiKey: settings.apiKey });
    return client(settings.model);
  }
  // OpenAI-compatible providers (DeepSeek today; Gemini/Groq/etc. later).
  const preset = OPENAI_COMPATIBLE_PRESETS[settings.provider as keyof typeof OPENAI_COMPATIBLE_PRESETS];
  if (preset) {
    const disableThinking = preset.supportsThinkingToggle
      ? (opts.disableThinking ?? settings.reasoningMode !== "thinking")
      : false;
    const client = createOpenAICompatible({
      name: preset.name,
      baseURL: preset.baseURL,
      apiKey: settings.apiKey,
      ...(disableThinking ? { fetch: deepseekNonThinkingFetch } : {}),
    });
    return client(settings.model);
  }
  throw new Error(`unsupported AI provider: ${settings.provider || "(none)"}`);
}
