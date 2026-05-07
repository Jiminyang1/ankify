import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV1 } from "ai";
import { getAiRuntimeSettings, type AiRuntimeSettings } from "./settings";

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

/**
 * Build a LanguageModelV1 from the current provider settings. The active provider
 * is chosen in the dashboard; the API key is the current user's encrypted key
 * from settings. Server provider env keys are intentionally not used.
 */
export async function getActiveModel(userId: string): Promise<{ model: LanguageModelV1; settings: AiRuntimeSettings }> {
  const settings = await getAiRuntimeSettings(userId);
  return { model: buildModel(settings), settings };
}

export function buildModel(settings: AiRuntimeSettings): LanguageModelV1 {
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
      const client = createOpenAICompatible({
        name: "deepseek",
        baseURL: "https://api.deepseek.com/v1",
        apiKey: settings.apiKey,
        // DeepSeek V4 enables thinking mode by default, which adds tens of seconds
        // of reasoning before any structured output. Our card-generation task
        // doesn't need it, so we inject `thinking: { type: "disabled" }` into
        // every request body. (Has no effect on legacy `deepseek-chat`, and on
        // `deepseek-reasoner` thinking is intrinsic so the field is ignored.)
        fetch: deepseekNonThinkingFetch,
      });
      return client(settings.model);
    }
    default:
      throw new Error(`unsupported AI provider: ${settings.provider || "(none)"}`);
  }
}
