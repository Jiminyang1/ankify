import { getDb, schema } from "@ankify/db";
import { eq } from "drizzle-orm";
import type { AiProvider } from "@ankify/core";

export interface AiSettings {
  provider: AiProvider;
  model: string;
  /** If set, used in place of the env-provided key for this provider. */
  apiKey?: string;
}

export interface ReviewSettings {
  dailyReviewLimit: number;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "" as AiProvider,
  model: "",
};

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  dailyReviewLimit: 20,
};

const KEY_AI = "ai";
const KEY_REVIEW = "review";

export async function getAiSettings(): Promise<AiSettings> {
  const db = getDb();
  const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, KEY_AI));
  const row = rows[0];
  if (!row) return DEFAULT_AI_SETTINGS;
  return { ...DEFAULT_AI_SETTINGS, ...(row.value as Partial<AiSettings>) };
}

export async function setAiSettings(value: AiSettings) {
  const db = getDb();
  const existing = await getAiSettings();
  const next = {
    ...existing,
    ...value,
    apiKey: value.apiKey || existing.apiKey,
  };
  await db
    .insert(schema.settings)
    .values({ key: KEY_AI, value: next })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: next } });
}

export async function getReviewSettings(): Promise<ReviewSettings> {
  const db = getDb();
  const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, KEY_REVIEW));
  const row = rows[0];
  if (!row) return DEFAULT_REVIEW_SETTINGS;
  const value = row.value as Partial<ReviewSettings>;
  return {
    ...DEFAULT_REVIEW_SETTINGS,
    ...value,
    dailyReviewLimit: clampDailyLimit(value.dailyReviewLimit),
  };
}

export async function setReviewSettings(value: ReviewSettings) {
  const db = getDb();
  const next: ReviewSettings = {
    dailyReviewLimit: clampDailyLimit(value.dailyReviewLimit),
  };
  await db
    .insert(schema.settings)
    .values({ key: KEY_REVIEW, value: next })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: next } });
}

function clampDailyLimit(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_REVIEW_SETTINGS.dailyReviewLimit;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}
