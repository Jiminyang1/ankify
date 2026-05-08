import { getDb, schema } from "@ankify/db";
import { and, eq } from "drizzle-orm";
import type { AiProvider, AiReasoningMode } from "@ankify/core";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "./secret-box";

export interface AiSettings {
  provider: AiProvider;
  model: string;
  reasoningMode: AiReasoningMode;
  encryptedApiKey?: EncryptedSecret;
}

export interface AiRuntimeSettings {
  provider: AiProvider;
  model: string;
  reasoningMode: AiReasoningMode;
  apiKey: string;
}

export interface ReviewSettings {
  dailyReviewLimit: number;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "",
  model: "",
  reasoningMode: "fast",
};

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  dailyReviewLimit: 20,
};

const KEY_AI = "ai";
const KEY_REVIEW = "review";

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
  const next = {
    ...existing,
    provider: value.provider,
    model: value.model,
    reasoningMode: value.reasoningMode ?? existing.reasoningMode,
    encryptedApiKey:
      value.apiKey === undefined
        ? existing.encryptedApiKey
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

export async function getReviewSettings(userId: string): Promise<ReviewSettings> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, KEY_REVIEW)));
  const row = rows[0];
  if (!row) return DEFAULT_REVIEW_SETTINGS;
  const value = row.value as Partial<ReviewSettings>;
  return {
    ...DEFAULT_REVIEW_SETTINGS,
    ...value,
    dailyReviewLimit: clampDailyLimit(value.dailyReviewLimit),
  };
}

export async function setReviewSettings(userId: string, value: ReviewSettings) {
  const db = getDb();
  const next: ReviewSettings = {
    dailyReviewLimit: clampDailyLimit(value.dailyReviewLimit),
  };
  await db
    .insert(schema.settings)
    .values({ userId, key: KEY_REVIEW, value: next })
    .onConflictDoUpdate({
      target: [schema.settings.userId, schema.settings.key],
      set: { value: next, updatedAt: new Date() },
    });
}

function clampDailyLimit(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_REVIEW_SETTINGS.dailyReviewLimit;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}
