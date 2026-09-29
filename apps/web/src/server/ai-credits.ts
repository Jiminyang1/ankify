import { getDb, schema, type DB } from "@ankify/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { readBillingConfig } from "./billing/config";
import {
  getStarterAiStatus,
  readStarterAiUsed,
  returnStarterAiCredit,
  StarterCreditsExhaustedError,
  tryConsumeStarterAiCredit,
} from "./starter-ai";

/**
 * Hosted AI credits: work that runs on the server's AI key instead of the
 * user's own. Free starter credits are always used up first; purchased credits
 * pay whatever is left, so one action may be split across both.
 * Every spend is tied to the job or Study Coach run it paid for, so a failed
 * run can give its credit back exactly once.
 */
type DbTransaction = Parameters<Parameters<DB["transaction"]>[0]>[0];

export type CreditAction = "card" | "quiz" | "coach";
export type CreditRef = { type: "ai_job" | "agent_run"; id: string };
export type CreditBucket = "starter" | "paid";

/** Credits charged per action, from free and purchased credits alike. */
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

/** How many credits of one action each bucket paid. */
export type CreditSplit = Record<CreditBucket, number>;

/**
 * Spends one action's worth of hosted credit inside the caller's transaction,
 * so the credit and the job/run it pays for commit or roll back together.
 * Remaining free credits pay first and purchased credits cover the rest
 * (3 free left for a 5-credit turn: 3 free + 2 purchased), with one ledger row
 * per bucket used. Throws StarterCreditsExhaustedError when both buckets
 * together can't cover the cost; nothing is spent then.
 */
export async function spendHostedCredit(
  tx: DbTransaction,
  userId: string,
  args: { action: CreditAction; ref: CreditRef; starterLimit: number },
): Promise<CreditSplit> {
  const cost = CREDIT_COST[args.action];

  // The ledger index is per bucket, so it alone would let a repeated spend for
  // the same work through in the other bucket. Writers are serialized, so this
  // check cannot race.
  const [alreadySpent] = await tx
    .select({ id: schema.aiCreditLedger.id })
    .from(schema.aiCreditLedger)
    .where(
      and(
        eq(schema.aiCreditLedger.reason, "spend"),
        eq(schema.aiCreditLedger.refType, args.ref.type),
        eq(schema.aiCreditLedger.refId, args.ref.id),
      ),
    )
    .limit(1);
  if (alreadySpent) throw new Error(`credit_already_spent: ${args.ref.type} ${args.ref.id}`);

  const starterLeft = Math.max(0, args.starterLimit - (await readStarterAiUsed(tx, userId)));
  const split: CreditSplit = { starter: Math.min(cost, starterLeft), paid: 0 };
  split.paid = cost - split.starter;

  if (split.paid > 0) {
    const rows = await tx
      .update(schema.aiCreditBalances)
      .set({
        balance: sql`${schema.aiCreditBalances.balance} - ${split.paid}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.aiCreditBalances.userId, userId),
          gte(schema.aiCreditBalances.balance, split.paid),
        ),
      )
      .returning({ balance: schema.aiCreditBalances.balance });
    if (rows.length === 0) throw creditsExhaustedError();
  }
  if (split.starter > 0 && !(await tryConsumeStarterAiCredit(tx, userId, args.starterLimit, split.starter))) {
    throw creditsExhaustedError();
  }

  for (const bucket of ["starter", "paid"] as const) {
    if (split[bucket] === 0) continue;
    await tx.insert(schema.aiCreditLedger).values({
      id: nanoid(16),
      userId,
      bucket,
      delta: -split[bucket],
      reason: "spend",
      refType: args.ref.type,
      refId: args.ref.id,
    });
  }
  return split;
}

/**
 * Returns the credits spent for `ref`, each part to the bucket it came from.
 * Idempotent: the unique ledger index lets only the first refund of each part
 * through, and work that never spent a hosted credit (the user's own key) has
 * no spend row to reverse.
 */
export async function refundHostedCredit(
  userId: string,
  ref: CreditRef,
  tx?: DbTransaction,
): Promise<boolean> {
  // Inside a caller's transaction this runs as a savepoint, so a failure
  // midway rolls back the refund rows and the counters together without
  // aborting the caller's job/run transition.
  return (tx ?? getDb()).transaction((inner) => refundInTransaction(inner, userId, ref));
}

async function refundInTransaction(tx: DbTransaction, userId: string, ref: CreditRef): Promise<boolean> {
  const spends = await tx
    .select()
    .from(schema.aiCreditLedger)
    .where(
      and(
        eq(schema.aiCreditLedger.userId, userId),
        eq(schema.aiCreditLedger.reason, "spend"),
        eq(schema.aiCreditLedger.refType, ref.type),
        eq(schema.aiCreditLedger.refId, ref.id),
      ),
    );

  let refunded = false;
  for (const spend of spends) {
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
    if (inserted.length === 0) continue;

    if (spend.bucket === "starter") {
      await returnStarterAiCredit(tx, userId, -spend.delta);
    } else {
      await addPaidCredits(tx, userId, -spend.delta);
    }
    refunded = true;
  }
  return refunded;
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
