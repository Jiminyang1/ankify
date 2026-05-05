import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV1 } from "ai";
import { getAiSettings, type AiSettings } from "./settings";

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
 * is chosen in the dashboard; the API key is read from settings (DB) first, then
 * the corresponding env var as fallback.
 */
export async function getActiveModel(): Promise<{ model: LanguageModelV1; settings: AiSettings }> {
  const settings = await getAiSettings();
  if (!settings.provider || !settings.model) {
    throw new Error("AI_NOT_CONFIGURED:请在 Settings 页面设置 AI provider 和 model");
  }
  return { model: buildModel(settings), settings };
}

export function buildModel(settings: AiSettings): LanguageModelV1 {
  switch (settings.provider) {
    case "anthropic": {
      const apiKey = settings.apiKey || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing (env or settings)");
      const client = createAnthropic({ apiKey });
      return client(settings.model);
    }
    case "openai": {
      const apiKey = settings.apiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_API_KEY missing (env or settings)");
      const client = createOpenAI({ apiKey });
      return client(settings.model);
    }
    case "deepseek": {
      const apiKey = settings.apiKey || process.env.DEEPSEEK_API_KEY;
      if (!apiKey) throw new Error("DEEPSEEK_API_KEY missing (env or settings)");
      const client = createOpenAICompatible({
        name: "deepseek",
        baseURL: "https://api.deepseek.com/v1",
        apiKey,
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
