import type { AiProvider } from "@ankify/core";
import { anthropicProvider } from "./anthropic";
import { deepseekProvider } from "./deepseek";
import { openaiProvider } from "./openai";
import type { ProviderAdapter, ProviderId } from "./types";

/**
 * Every supported provider. Provider-specific behavior lives only in these
 * adapters; the rest of the app goes through this registry.
 */
const PROVIDERS: Record<ProviderId, ProviderAdapter> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  deepseek: deepseekProvider,
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && value in PROVIDERS;
}

export function getProvider(id: ProviderId): ProviderAdapter {
  return PROVIDERS[id];
}

/** Maps retired model ids to their replacements; other ids pass through. */
export function normalizeModelId(provider: AiProvider, model: string): string {
  if (!isProviderId(provider)) return model;
  return PROVIDERS[provider].aliases?.[model] ?? model;
}
