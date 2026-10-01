import { getDb, schema, type DB } from "@ankify/db";
import { and, eq, sql } from "drizzle-orm";
import type { AiProvider } from "@ankify/core";

/**
 * Starter AI credits: a small, lifetime allowance of AI actions that new users
 * can spend on the server's own provider key before adding their own. Actions
 * cost different amounts (see CREDIT_COST in ai-credits.ts).
 *
 * The feature is off unless ANKIFY_STARTER_AI_API_KEY is set. The overall
 * spend cap is the provider account's prepaid balance, so the code only has to
 * enforce the per-user allowance. Spending goes through ai-credits.ts, which
 * falls back to purchased credits once the allowance is gone.
 */
export const STARTER_AI_USAGE_KEY = "starter-ai-usage";

const DEFAULT_PROVIDER = "deepseek";
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_CREDITS = 20;
const PROVIDERS: ReadonlyArray<Exclude<AiProvider, "">> = ["anthropic", "openai", "deepseek", "google"];

export interface StarterAiConfig {
  provider: Exclude<AiProvider, "">;
  model: string;
  apiKey: string;
  credits: number;
}

export interface StarterAiStatus {
  enabled: boolean;
  limit: number;
  used: number;
  remaining: number;
}

type DbExecutor = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

export class StarterCreditsExhaustedError extends Error {
  readonly code = "starter_credits_exhausted";
  constructor(
    message = "You don't have enough free AI credits left for this. Add your own API key in Settings to keep going.",
  ) {
    super(message);
  }
}

export function readStarterAiConfig(env: Record<string, string | undefined> = process.env): StarterAiConfig | null {
  const apiKey = env.ANKIFY_STARTER_AI_API_KEY?.trim();
  if (!apiKey) return null;
  const provider = (env.ANKIFY_STARTER_AI_PROVIDER?.trim() || DEFAULT_PROVIDER) as Exclude<AiProvider, "">;
  if (!PROVIDERS.includes(provider)) return null;
  const model = env.ANKIFY_STARTER_AI_MODEL?.trim() || DEFAULT_MODEL;
  const parsedCredits = Number.parseInt(env.ANKIFY_STARTER_AI_CREDITS ?? "", 10);
  const credits = Number.isFinite(parsedCredits) && parsedCredits >= 0 ? parsedCredits : DEFAULT_CREDITS;
  return { provider, model, apiKey, credits };
}

function readUsed(value: unknown) {
  const used = (value as { used?: unknown } | undefined)?.used;
  return typeof used === "number" && Number.isFinite(used) ? used : 0;
}

export async function getStarterAiStatus(userId: string): Promise<StarterAiStatus> {
  const config = readStarterAiConfig();
  if (!config) return { enabled: false, limit: 0, used: 0, remaining: 0 };
  const [row] = await getDb()
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, STARTER_AI_USAGE_KEY)))
    .limit(1);
  const used = readUsed(row?.value);
  return { enabled: true, limit: config.credits, used, remaining: Math.max(0, config.credits - used) };
}

/** Free credits used so far, read through the caller's transaction. */
export async function readStarterAiUsed(executor: DbExecutor, userId: string): Promise<number> {
  const [row] = await executor
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, STARTER_AI_USAGE_KEY)))
    .limit(1);
  return readUsed(row?.value);
}

const usedExpr = sql`CAST(json_extract(${schema.settings.value}, '$.used') AS INTEGER)`;

/**
 * Atomically spends `cost` starter credits. A single UPSERT increments the
 * counter only if the whole cost still fits under the limit, so concurrent
 * requests cannot overspend. Returns false when the allowance cannot cover it.
 */
export async function tryConsumeStarterAiCredit(
  executor: DbExecutor,
  userId: string,
  limit: number,
  cost = 1,
): Promise<boolean> {
  if (cost <= 0 || cost > limit) return false;
  const now = new Date();
  const rows = await executor
    .insert(schema.settings)
    .values({ userId, key: STARTER_AI_USAGE_KEY, value: { used: cost }, updatedAt: now })
    .onConflictDoUpdate({
      target: [schema.settings.userId, schema.settings.key],
      set: { value: sql`json_object('used', ${usedExpr} + ${cost})`, updatedAt: now },
      setWhere: sql`${usedExpr} + ${cost} <= ${limit}`,
    })
    .returning({ value: schema.settings.value });
  return rows.length > 0;
}

/** Gives starter credits back; never drops the counter below zero. */
export async function returnStarterAiCredit(executor: DbExecutor, userId: string, amount = 1): Promise<void> {
  await executor
    .update(schema.settings)
    .set({ value: sql`json_object('used', MAX(${usedExpr} - ${amount}, 0))`, updatedAt: new Date() })
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, STARTER_AI_USAGE_KEY)));
}
