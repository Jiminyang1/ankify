import { getDb, schema } from "@ankify/db";
import { and, eq, sql } from "drizzle-orm";
import type { AiProvider } from "@ankify/core";

/**
 * Starter AI credits: a small, lifetime allowance of AI actions that new users
 * can spend on the server's own provider key before adding their own. One
 * credit is one quiz generation, one card generation, or one Study Coach turn.
 *
 * The feature is off unless ANKIFY_STARTER_AI_API_KEY is set. The overall
 * spend cap is the provider account's prepaid balance, so the code only has to
 * enforce the per-user allowance.
 */
export const STARTER_AI_USAGE_KEY = "starter-ai-usage";

const DEFAULT_PROVIDER = "deepseek";
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_CREDITS = 30;
const PROVIDERS: ReadonlyArray<Exclude<AiProvider, "">> = ["anthropic", "openai", "deepseek"];

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

export class StarterCreditsExhaustedError extends Error {
  readonly code = "starter_credits_exhausted";
  constructor() {
    super("You've used all your free AI credits. Add your own API key in Settings to keep going.");
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

/**
 * Atomically spends one starter credit. A single UPSERT increments the counter
 * only while it is below the limit, so concurrent requests cannot overspend.
 * Throws StarterCreditsExhaustedError when nothing is left.
 */
export async function consumeStarterAiCredit(userId: string, limit: number): Promise<void> {
  if (limit <= 0) throw new StarterCreditsExhaustedError();
  const now = new Date();
  const used = sql`CAST(json_extract(${schema.settings.value}, '$.used') AS INTEGER)`;
  const rows = await getDb()
    .insert(schema.settings)
    .values({ userId, key: STARTER_AI_USAGE_KEY, value: { used: 1 }, updatedAt: now })
    .onConflictDoUpdate({
      target: [schema.settings.userId, schema.settings.key],
      set: { value: sql`json_object('used', ${used} + 1)`, updatedAt: now },
      setWhere: sql`${used} < ${limit}`,
    })
    .returning({ value: schema.settings.value });
  if (rows.length === 0) throw new StarterCreditsExhaustedError();
}
