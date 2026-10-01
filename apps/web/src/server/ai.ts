import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { isQaProfile } from "./qa";
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

interface BuildModelOptions {
  /** If true and the provider supports a thinking-toggle, force-disable
   *  thinking for this client (probes, latency-sensitive paths). */
  disableThinking?: boolean;
}

type BuildModelSettings = Pick<AiRuntimeSettings, "provider" | "model" | "apiKey"> & {
  reasoningMode?: AiRuntimeSettings["reasoningMode"];
};

/**
 * Build a language model from the current provider settings: the user's own
 * encrypted key when configured, otherwise the server's starter-credit key
 * (see starter-ai.ts). Callers starting new AI work spend a starter credit
 * when `settings.source` is "starter".
 */
export async function getActiveModel(userId: string, opts: BuildModelOptions = {}): Promise<{ model: LanguageModel; settings: AiRuntimeSettings }> {
  const settings = await getAiRuntimeSettings(userId);
  return { model: buildModel(settings, opts), settings };
}

/** Gemini counts its thinking tokens against `maxOutputTokens`, so a call
 * capped for the answer alone can run out before it writes any output.
 * Gemini calls keep thinking low and get this much extra room for it. */
export const GEMINI_THINKING_HEADROOM_TOKENS = 4_000;

/** Per-call options for a provider, merged into `generateText`. Gemini 3 takes a
 * thinking level and Gemini 2.5 a token budget; other ids get only headroom. */
export function providerCallOptions(settings: Pick<BuildModelSettings, "provider" | "model">, maxOutputTokens: number) {
  if (settings.provider !== "google") return { maxOutputTokens };
  const thinkingConfig = /^gemini-3/.test(settings.model)
    ? { thinkingLevel: "low" as const }
    : /^gemini-2\.5/.test(settings.model)
      ? { thinkingBudget: 1_024 }
      : undefined;
  return {
    maxOutputTokens: maxOutputTokens + GEMINI_THINKING_HEADROOM_TOKENS,
    ...(thinkingConfig ? { providerOptions: { google: { thinkingConfig } } } : {}),
  };
}

export function buildModel(settings: BuildModelSettings, opts: BuildModelOptions = {}): LanguageModel {
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
  if (settings.provider === "google") {
    // Native Gemini client: structured output uses Gemini's response schema.
    const client = createGoogleGenerativeAI({ apiKey: settings.apiKey });
    return client(settings.model);
  }
  // OpenAI-compatible providers (DeepSeek today).
  const preset = OPENAI_COMPATIBLE_PRESETS[settings.provider as keyof typeof OPENAI_COMPATIBLE_PRESETS];
  if (preset) {
    const disableThinking = preset.supportsThinkingToggle
      ? (opts.disableThinking ?? settings.reasoningMode !== "thinking")
      : false;
    const client = createOpenAICompatible({
      name: preset.name,
      // QA and browser tests point this preset at a local fake provider.
      baseURL: (isQaProfile() && process.env.ANKIFY_QA_AI_BASE_URL) || preset.baseURL,
      apiKey: settings.apiKey,
      ...(disableThinking ? { fetch: deepseekNonThinkingFetch } : {}),
    });
    return client(settings.model);
  }
  throw new Error(`unsupported AI provider: ${settings.provider || "(none)"}`);
}
