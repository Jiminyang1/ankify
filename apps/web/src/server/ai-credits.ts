import { getDb, schema, type DB } from "@ankify/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { readBillingConfig } from "./billing/config";
import {
  getStarterAiStatus,
  returnStarterAiCredit,
  StarterCreditsExhaustedError,
  tryConsumeStarterAiCredit,
} from "./starter-ai";

/**
 * Hosted AI credits: work that runs on the server's AI key instead of the
 * user's own. Free starter credits are spent first, then purchased credits.
 * Every spend is tied to the job or Study Coach run it paid for, so a failed
 * run can give its credit back exactly once.
 */
type DbTransaction = Parameters<Parameters<DB["transaction"]>[0]>[0];

export type CreditAction = "card" | "quiz" | "coach";
export type CreditRef = { type: "ai_job" | "agent_run"; id: string };
export type CreditBucket = "starter" | "paid";

/**
 * Credits charged per action, from free and purchased credits alike. A spend
 * is paid entirely from one bucket: free credits if they cover the whole cost,
 * otherwise purchased credits.
 */
export const CREDIT_COST: Record<CreditAction, number> = {
  card: 1,
  quiz: 2,
  coach: 5,
};

export interface HostedCreditStatus {
  /** The server AI key is configured, so hosted credits exist at all. */
  enabled: boolean;
  starterLimit: number;
  starterRemaining: number;
  paidBalance: number;
  billingEnabled: boolean;
}

export function creditsExhaustedError() {
  return new StarterCreditsExhaustedError(
    readBillingConfig()
      ? "You don't have enough AI credits left for this. Buy more or add your own API key in Settings to keep going."
      : undefined,
  );
}

/**
 * Spends one action's worth of hosted credit inside the caller's transaction,
 * so the credit and the job/run it pays for commit or roll back together.
 * Throws StarterCreditsExhaustedError when neither bucket can cover it.
 */
export async function spendHostedCredit(
  tx: DbTransaction,
  userId: string,
  args: { action: CreditAction; ref: CreditRef; starterLimit: number },
): Promise<CreditBucket> {
  const cost = CREDIT_COST[args.action];
  let bucket: CreditBucket;
  let delta: number;
  if (await tryConsumeStarterAiCredit(tx, userId, args.starterLimit, cost)) {
    bucket = "starter";
    delta = -cost;
  } else {
    const rows = await tx
      .update(schema.aiCreditBalances)
      .set({
        balance: sql`${schema.aiCreditBalances.balance} - ${cost}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.aiCreditBalances.userId, userId),
          gte(schema.aiCreditBalances.balance, cost),
        ),
      )
      .returning({ balance: schema.aiCreditBalances.balance });
    if (rows.length === 0) throw creditsExhaustedError();
    bucket = "paid";
    delta = -cost;
  }

  await tx.insert(schema.aiCreditLedger).values({
    id: nanoid(16),
    userId,
    bucket,
    delta,
    reason: "spend",
    refType: args.ref.type,
    refId: args.ref.id,
  });
  return bucket;
}

/**
 * Returns the credit spent for `ref`. Idempotent: the unique ledger index lets
 * only the first refund through, and work that never spent a hosted credit
 * (the user's own key) has no spend row to reverse.
 */
export async function refundHostedCredit(
  userId: string,
  ref: CreditRef,
  tx?: DbTransaction,
): Promise<boolean> {
  // Inside a caller's transaction this runs as a savepoint, so a failure
  // midway rolls back the refund row and the counter together without
  // aborting the caller's job/run transition.
  return (tx ?? getDb()).transaction((inner) => refundInTransaction(inner, userId, ref));
}

async function refundInTransaction(tx: DbTransaction, userId: string, ref: CreditRef): Promise<boolean> {
  const [spend] = await tx
    .select()
    .from(schema.aiCreditLedger)
    .where(
      and(
        eq(schema.aiCreditLedger.userId, userId),
        eq(schema.aiCreditLedger.reason, "spend"),
        eq(schema.aiCreditLedger.refType, ref.type),
        eq(schema.aiCreditLedger.refId, ref.id),
      ),
    )
    .limit(1);
  if (!spend) return false;

  const inserted = await tx
    .insert(schema.aiCreditLedger)
    .values({
      id: nanoid(16),
      userId,
      bucket: spend.bucket,
      delta: -spend.delta,
      reason: "refund",
      refType: ref.type,
      refId: ref.id,
    })
    .onConflictDoNothing()
    .returning({ id: schema.aiCreditLedger.id });
  if (inserted.length === 0) return false;

  if (spend.bucket === "starter") {
    await returnStarterAiCredit(tx, userId, -spend.delta);
  } else {
    await addPaidCredits(tx, userId, -spend.delta);
  }
  return true;
}

/**
 * Refund for failure paths that must not fail themselves: the job or run is
 * already terminal, so a refund error is logged instead of thrown.
 */
export async function refundHostedCreditSafely(userId: string, ref: CreditRef, tx?: DbTransaction) {
  try {
    await refundHostedCredit(userId, ref, tx);
  } catch (error) {
    console.error("[ai-credits] refund failed", {
      ref,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function addPaidCredits(tx: DbTransaction, userId: string, credits: number) {
  const now = new Date();
  await tx
    .insert(schema.aiCreditBalances)
    .values({ userId, balance: credits, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.aiCreditBalances.userId,
      set: { balance: sql`${schema.aiCreditBalances.balance} + ${credits}`, updatedAt: now },
    });
}

/** Removes up to `credits` purchased credits, stopping at zero. Returns the amount removed. */
export async function removePaidCredits(tx: DbTransaction, userId: string, credits: number) {
  const [row] = await tx
    .select({ balance: schema.aiCreditBalances.balance })
    .from(schema.aiCreditBalances)
    .where(eq(schema.aiCreditBalances.userId, userId))
    .limit(1);
  const removed = Math.min(row?.balance ?? 0, credits);
  if (removed > 0) {
    await tx
      .update(schema.aiCreditBalances)
      .set({ balance: sql`${schema.aiCreditBalances.balance} - ${removed}`, updatedAt: new Date() })
      .where(eq(schema.aiCreditBalances.userId, userId));
  }
  return removed;
}

export async function getPaidCreditBalance(userId: string) {
  const [row] = await getDb()
    .select({ balance: schema.aiCreditBalances.balance })
    .from(schema.aiCreditBalances)
    .where(eq(schema.aiCreditBalances.userId, userId))
    .limit(1);
  return row?.balance ?? 0;
}

export async function getHostedCreditStatus(userId: string): Promise<HostedCreditStatus> {
  const [starter, paidBalance] = await Promise.all([
    getStarterAiStatus(userId),
    getPaidCreditBalance(userId),
  ]);
  return {
    enabled: starter.enabled,
    starterLimit: starter.limit,
    starterRemaining: starter.remaining,
    paidBalance,
    billingEnabled: readBillingConfig() !== null,
  };
}
