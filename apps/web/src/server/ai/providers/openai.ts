import { createOpenAI } from "@ai-sdk/openai";
import { ProviderHttpError, type ProviderAdapter } from "./types";

/**
 * OpenAI. Reasoning models reason adaptively and default to `medium` effort.
 * Not every model accepts `none` (GPT-6 Astra returns a 400), so the lightest
 * setting used here is `low`, which every reasoning model accepts.
 * Non-reasoning models get nothing.
 */
const REASONING_MODEL = /^(gpt-5|gpt-6|o\d)/;

export const openaiProvider: ProviderAdapter = {
  id: "openai",
  label: "OpenAI",
  presets: ["gpt-5", "gpt-4o", "gpt-4o-mini"],
  legacyFastModeToggle: false,

  createModel({ apiKey, model }) {
    return createOpenAI({ apiKey })(model);
  },

  reasoningOptions(model, request) {
    if (request !== "lightest" || !REASONING_MODEL.test(model)) return undefined;
    return { openai: { reasoningEffort: "low" } };
  },

  async listModels(apiKey, signal) {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!response.ok) throw new ProviderHttpError(response.status);
    const json = (await response.json()) as { data?: Array<{ id: string }> };
    return (json.data ?? [])
      .map((model) => ({ id: model.id }))
      .filter((model) => isChatModel(model.id))
      .sort((a, b) => b.id.localeCompare(a.id));
  },
};

const NON_CHAT_KEYWORDS = [
  "embed",
  "whisper",
  "tts",
  "dall-e",
  "moderation",
  "audio",
  "realtime",
  "image",
  "transcribe",
  "babbage",
  "davinci-edit",
  "instruct",
  "search",
];

function isChatModel(id: string) {
  const lower = id.toLowerCase();
  if (NON_CHAT_KEYWORDS.some((keyword) => lower.includes(keyword))) return false;
  return lower.startsWith("gpt-") || lower.startsWith("chatgpt") || /^o\d/.test(lower);
}
