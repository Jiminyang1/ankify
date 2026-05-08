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

export interface BuildModelOptions {
  /** If true and provider is DeepSeek, force-disable thinking mode for this client. */
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
export async function getActiveModel(userId: string): Promise<{ model: LanguageModelV1; settings: AiRuntimeSettings }> {
  const settings = await getAiRuntimeSettings(userId);
  return { model: buildModel(settings), settings };
}

export function buildModel(settings: BuildModelSettings, opts: BuildModelOptions = {}): LanguageModelV1 {
  switch (settings.provider) {
    case "anthropic": {
      const client = createAnthropic({ apiKey: settings.apiKey });
      return client(settings.model);
    }
    case "openai": {
      const client = createOpenAI({ apiKey: settings.apiKey });
      return client(settings.model);
    }
    case "deepseek": {
      const disableThinking = opts.disableThinking ?? settings.reasoningMode !== "thinking";
      const client = createOpenAICompatible({
        name: "deepseek",
        baseURL: "https://api.deepseek.com/v1",
        apiKey: settings.apiKey,
        ...(disableThinking ? { fetch: deepseekNonThinkingFetch } : {}),
      });
      return client(settings.model);
    }
    default:
      throw new Error(`unsupported AI provider: ${settings.provider || "(none)"}`);
  }
}
