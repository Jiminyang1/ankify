import { getDb, schema } from "@ankify/db";
import { and, eq } from "drizzle-orm";
import { cache } from "react";
import type { AiProvider, AiReasoningMode } from "@ankify/core";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "./secret-box";
import { isValidTimeZone, normalizeTimeZone } from "./time-zone";
import { DEFAULT_LANGUAGE, normalizeLanguage, type Language } from "@/lib/i18n";

interface AiSettings {
  provider: AiProvider;
  model: string;
  reasoningMode: AiReasoningMode;
  encryptedApiKey?: EncryptedSecret;
}

export interface AiRuntimeSettings {
  provider: Exclude<AiProvider, "">;
  model: string;
  reasoningMode: AiReasoningMode;
  apiKey: string;
}

interface ReviewSettings {
  dailyReviewLimit: number;
  timeZone: string;
  timeZoneConfigured: boolean;
}

interface GenerationSettings {
  language: Language;
}

const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "",
  model: "",
  reasoningMode: "fast",
};

const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  dailyReviewLimit: 20,
  timeZone: "UTC",
  timeZoneConfigured: false,
};

const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  language: DEFAULT_LANGUAGE,
};

const KEY_AI = "ai";
const KEY_REVIEW = "review";
const KEY_GENERATION = "generation";

export async function getAiSettings(userId: string): Promise<AiSettings> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, KEY_AI)));
  const row = rows[0];
  if (!row) return DEFAULT_AI_SETTINGS;
  const value = { ...DEFAULT_AI_SETTINGS, ...(row.value as Partial<AiSettings>) };
  return {
    ...value,
    reasoningMode: value.reasoningMode === "thinking" ? "thinking" : "fast",
  };
}

export async function getAiRuntimeSettings(userId: string): Promise<AiRuntimeSettings> {
  const settings = await getAiSettings(userId);
  if (!settings.provider || !settings.model) {
    throw new Error("AI_NOT_CONFIGURED: Configure AI provider and model in Settings.");
  }
  if (!settings.encryptedApiKey) {
    throw new Error("AI_KEY_MISSING: Add your provider API key in Settings.");
  }
  return {
    provider: settings.provider,
    model: settings.model,
    reasoningMode: settings.reasoningMode,
    apiKey: decryptSecret(settings.encryptedApiKey),
  };
}

export async function setAiSettings(
  userId: string,
  value: { provider: AiProvider; model: string; reasoningMode?: AiReasoningMode; apiKey?: string },
) {
  const db = getDb();
  const existing = await getAiSettings(userId);
  // A stored key belongs to the provider it was entered for. Never carry it
  // over to a different provider — it would be sent to the wrong API.
  const retainedKey =
    existing.provider === value.provider ? existing.encryptedApiKey : undefined;
  const next = {
    ...existing,
    provider: value.provider,
    model: value.model,
    reasoningMode: value.reasoningMode ?? existing.reasoningMode,
    encryptedApiKey:
      value.apiKey === undefined
        ? retainedKey
        : value.apiKey
          ? encryptSecret(value.apiKey)
          : undefined,
  };
  await db
    .insert(schema.settings)
    .values({ userId, key: KEY_AI, value: next })
    .onConflictDoUpdate({
      target: [schema.settings.userId, schema.settings.key],
      set: { value: next, updatedAt: new Date() },
    });
}

async function readReviewSettings(userId: string): Promise<ReviewSettings> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, KEY_REVIEW)));
  const row = rows[0];
  if (!row) return DEFAULT_REVIEW_SETTINGS;
  const value = row.value as Partial<ReviewSettings>;
  const timeZoneConfigured = isValidTimeZone(value.timeZone);
  return {
    dailyReviewLimit: clampDailyLimit(value.dailyReviewLimit),
    timeZone: normalizeTimeZone(value.timeZone),
    timeZoneConfigured,
  };
}

/** Memoized per request — the queue status and the analysis page both read it.
 *  Writers use readReviewSettings() so they always merge against fresh state. */
export const getReviewSettings = cache(readReviewSettings);

export async function setReviewSettings(
  userId: string,
  value: { dailyReviewLimit?: number; timeZone?: string },
) {
  const db = getDb();
  const existing = await readReviewSettings(userId);
  const next: { dailyReviewLimit: number; timeZone?: string } = {
    dailyReviewLimit: clampDailyLimit(value.dailyReviewLimit ?? existing.dailyReviewLimit),
    ...(existing.timeZoneConfigured ? { timeZone: existing.timeZone } : {}),
    ...(value.timeZone !== undefined ? { timeZone: normalizeTimeZone(value.timeZone) } : {}),
  };
  await db
    .insert(schema.settings)
    .values({ userId, key: KEY_REVIEW, value: next })
    .onConflictDoUpdate({
      target: [schema.settings.userId, schema.settings.key],
      set: { value: next, updatedAt: new Date() },
    });
}

async function readGenerationSettings(userId: string): Promise<GenerationSettings> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, KEY_GENERATION)));
  const row = rows[0];
  if (!row) return DEFAULT_GENERATION_SETTINGS;
  const value = row.value as Partial<GenerationSettings>;
  return { language: normalizeLanguage(value.language) };
}

export const getGenerationSettings = cache(readGenerationSettings);

export async function setGenerationSettings(
  userId: string,
  value: Partial<GenerationSettings>,
) {
  const db = getDb();
  const existing = await readGenerationSettings(userId);
  const next: GenerationSettings = {
    language:
      value.language === undefined ? existing.language : normalizeLanguage(value.language),
  };
  await db
    .insert(schema.settings)
    .values({ userId, key: KEY_GENERATION, value: next })
    .onConflictDoUpdate({
      target: [schema.settings.userId, schema.settings.key],
      set: { value: next, updatedAt: new Date() },
    });
}

function clampDailyLimit(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_REVIEW_SETTINGS.dailyReviewLimit;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}
