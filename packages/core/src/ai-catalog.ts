import type { AiProvider } from "./types";

export type AiProviderId = Exclude<AiProvider, "">;

/**
 * Reasoning level stored in AI settings.
 * - "default": send nothing; the provider decides (current models think adaptively).
 * - "off": turn thinking off, only offered where the model allows it.
 * - anything else: the provider's native effort value (e.g. "low", "max").
 */
export type AiReasoningLevel = string;
export const DEFAULT_REASONING_LEVEL = "default";

export interface AiModelInfo {
  id: string;
  /** Native levels this model accepts, in increasing order. Empty = no reasoning control. */
  reasoningLevels: readonly string[];
}

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  /** Suggested models, recommended default first. */
  models: readonly AiModelInfo[];
}

const CLAUDE_EFFORT = ["low", "medium", "high", "xhigh", "max"] as const;
const DEEPSEEK_LEVELS = ["off", "low", "high", "max"] as const;

/**
 * Client-safe catalog of suggested models and the reasoning levels each accepts.
 * Sources (2026-09): Anthropic model docs; OpenAI GPT-6 model pages; DeepSeek
 * thinking-mode guide. The server adapters in apps/web/src/server/ai/providers
 * translate these levels into request options.
 */
export const AI_PROVIDERS: readonly AiProviderInfo[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    models: [
      // Thinking is always on for Sonnet 5.5 / Opus 5.5; effort is the only control.
      { id: "claude-sonnet-5-5", reasoningLevels: CLAUDE_EFFORT },
      { id: "claude-opus-5-5", reasoningLevels: CLAUDE_EFFORT },
      // Haiku 4.5 has no effort control.
      { id: "claude-haiku-4-5", reasoningLevels: [] },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    models: [
      { id: "gpt-6-sol", reasoningLevels: ["none", "low", "medium", "high", "xhigh", "max"] },
      { id: "gpt-6-luna", reasoningLevels: ["none", "low", "medium", "high", "xhigh", "max"] },
      // Astra rejects `none`.
      { id: "gpt-6-astra", reasoningLevels: ["low", "medium", "high", "xhigh", "max"] },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    models: [
      { id: "deepseek-flash", reasoningLevels: DEEPSEEK_LEVELS },
      { id: "deepseek-v4-pro", reasoningLevels: DEEPSEEK_LEVELS },
    ],
  },
];

export function getAiProviderInfo(provider: AiProvider): AiProviderInfo | undefined {
  return AI_PROVIDERS.find((entry) => entry.id === provider);
}

/** Levels the user can pick for this model; empty for models outside the catalog. */
export function getReasoningLevels(provider: AiProvider, model: string): readonly string[] {
  return getAiProviderInfo(provider)?.models.find((entry) => entry.id === model)?.reasoningLevels ?? [];
}

/** A stored level if this model accepts it, otherwise "default". */
export function normalizeReasoningLevel(
  provider: AiProvider,
  model: string,
  level: string | undefined,
): AiReasoningLevel {
  if (!level || level === DEFAULT_REASONING_LEVEL) return DEFAULT_REASONING_LEVEL;
  return getReasoningLevels(provider, model).includes(level) ? level : DEFAULT_REASONING_LEVEL;
}
