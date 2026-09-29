import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@ankify/db";
import {
  addPaidCredits,
  getPaidCreditBalance,
  refundHostedCredit,
  refundHostedCreditSafely,
  spendHostedCredit,
  type CreditAction,
} from "./ai-credits";
import { getStarterAiStatus, StarterCreditsExhaustedError } from "./starter-ai";
import { createTestDb } from "./test-db";

const testDb = createTestDb();
process.env.ANKIFY_STARTER_AI_API_KEY = "sk-test";
process.env.ANKIFY_STARTER_AI_CREDITS = "2";

const USER_ID = "user-credits";
const STARTER_LIMIT = 2;

/** Card actions cost 1 credit, so counts below equal credits. */
async function spend(refId: string, starterLimit = STARTER_LIMIT, action: CreditAction = "card") {
  return getDb().transaction((tx) =>
    spendHostedCredit(tx, USER_ID, {
      action,
      ref: { type: action === "coach" ? "agent_run" : "ai_job", id: refId },
      starterLimit,
    }),
  );
}

/** Drizzle wraps driver errors, so the injected trigger message is on `cause`. */
async function expectInjectedFailure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e as Error & { cause?: Error },
  );
  expect(error).not.toBeNull();
  expect(`${error?.message} ${error?.cause?.message ?? ""}`).toContain("injected failure");
}

async function setPaidBalance(balance: number) {
  await getDb().delete(schema.aiCreditBalances).where(eq(schema.aiCreditBalances.userId, USER_ID));
  if (balance > 0) await getDb().transaction((tx) => addPaidCredits(tx, USER_ID, balance));
}

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values({ id: USER_ID, name: "Test", email: "credits@example.com" });
});

async function injectFailure(name: string, table: string, event: "INSERT" | "UPDATE") {
  await testDb.exec(
    `CREATE TRIGGER ${name} BEFORE ${event} ON ${table} BEGIN SELECT RAISE(ABORT, 'injected failure'); END`,
  );
}

beforeEach(async () => {
  const db = getDb();
  for (const name of ["fail_ledger_insert", "fail_settings_update", "fail_balance_update"]) {
    await testDb.exec(`DROP TRIGGER IF EXISTS ${name}`);
  }
  await db.delete(schema.aiCreditLedger);
  await db.delete(schema.aiCreditBalances);
  await db.delete(schema.settings);
});

afterAll(() => testDb.cleanup());

describe("hosted AI credits", () => {
  it("spends starter credits first, then purchased credits, then refuses", async () => {
    await setPaidBalance(1);

    expect(await spend("job-1")).toEqual({ starter: 1, paid: 0 });
    expect(await spend("job-2")).toEqual({ starter: 1, paid: 0 });
    expect(await spend("job-3")).toEqual({ starter: 0, paid: 1 });
    await expect(spend("job-4")).rejects.toBeInstanceOf(StarterCreditsExhaustedError);

    expect((await getStarterAiStatus(USER_ID)).remaining).toBe(0);
    expect(await getPaidCreditBalance(USER_ID)).toBe(0);
    const spends = await getDb()
      .select()
      .from(schema.aiCreditLedger)
      .where(eq(schema.aiCreditLedger.reason, "spend"));
    expect(spends.map((row) => [row.refId, row.bucket, row.delta]).sort()).toEqual([
      ["job-1", "starter", -1],
      ["job-2", "starter", -1],
      ["job-3", "paid", -1],
    ]);
  });

  it("refunds each spend once, into the bucket it came from", async () => {
    await setPaidBalance(1);
    await spend("job-1");
    await spend("job-2");
    await spend("job-3");

    const ref = (id: string) => ({ type: "ai_job" as const, id });
    expect(await refundHostedCredit(USER_ID, ref("job-3"))).toBe(true);
    expect(await refundHostedCredit(USER_ID, ref("job-3"))).toBe(false);
    expect(await getPaidCreditBalance(USER_ID)).toBe(1);

    expect(await refundHostedCredit(USER_ID, ref("job-1"))).toBe(true);
    expect(await refundHostedCredit(USER_ID, ref("job-1"))).toBe(false);
    expect((await getStarterAiStatus(USER_ID)).remaining).toBe(1);
  });

  it("does nothing for work that never spent a hosted credit", async () => {
    expect(await refundHostedCredit(USER_ID, { type: "agent_run", id: "own-key-run" })).toBe(false);
    expect(await getPaidCreditBalance(USER_ID)).toBe(0);
  });

  it("rolls the spend back with the caller's transaction", async () => {
    await expect(
      getDb().transaction(async (tx) => {
        await spendHostedCredit(tx, USER_ID, {
          action: "quiz",
          ref: { type: "ai_job", id: "rolled-back" },
          starterLimit: STARTER_LIMIT,
        });
        throw new Error("job insert failed");
      }),
    ).rejects.toThrow("job insert failed");

    expect((await getStarterAiStatus(USER_ID)).remaining).toBe(STARTER_LIMIT);
    const ledger = await getDb()
      .select()
      .from(schema.aiCreditLedger)
      .where(and(eq(schema.aiCreditLedger.userId, USER_ID), eq(schema.aiCreditLedger.refId, "rolled-back")));
    expect(ledger).toHaveLength(0);
  });

  it("enforces the non-negative balance in SQL and refuses to overspend", async () => {
    await setPaidBalance(1);
    await expect(
      getDb().update(schema.aiCreditBalances).set({ balance: -1 }).where(eq(schema.aiCreditBalances.userId, USER_ID)),
    ).rejects.toThrow();

    expect(await spend("paid-1", 0)).toEqual({ starter: 0, paid: 1 });
    await expect(spend("paid-2", 0)).rejects.toBeInstanceOf(StarterCreditsExhaustedError);
    expect(await getPaidCreditBalance(USER_ID)).toBe(0);
  });

  it("rejects a second spend for the same job, even from the other bucket", async () => {
    await setPaidBalance(5);
    await spend("job-1");
    await expect(spend("job-1")).rejects.toThrow("credit_already_spent");
    // With free credits gone, a repeat would land in the paid bucket, which the
    // per-bucket ledger index alone would not catch.
    await expect(spend("job-1", 1)).rejects.toThrow("credit_already_spent");
    expect((await getStarterAiStatus(USER_ID)).remaining).toBe(STARTER_LIMIT - 1);
    expect(await getPaidCreditBalance(USER_ID)).toBe(5);
  });

  it("does not consume credit when the ledger write fails", async () => {
    await setPaidBalance(1);
    await injectFailure("fail_ledger_insert", "ai_credit_ledger", "INSERT");

    await expectInjectedFailure(spend("starter-job"));
    expect((await getStarterAiStatus(USER_ID)).remaining).toBe(STARTER_LIMIT);

    await expectInjectedFailure(spend("paid-job", 0));
    expect(await getPaidCreditBalance(USER_ID)).toBe(1);
  });

  it("keeps a failed refund atomic inside the caller's transaction", async () => {
    await spend("job-1");
    await injectFailure("fail_settings_update", "settings", "UPDATE");

    // The job transition around the refund must still commit.
    await getDb().transaction(async (tx) => {
      await refundHostedCreditSafely(USER_ID, { type: "ai_job", id: "job-1" }, tx);
      await tx.insert(schema.settings).values({ userId: USER_ID, key: "outer-write", value: { ok: true } });
    });

    const [outer] = await getDb()
      .select()
      .from(schema.settings)
      .where(and(eq(schema.settings.userId, USER_ID), eq(schema.settings.key, "outer-write")));
    expect(outer).toBeDefined();
    const refunds = await getDb()
      .select()
      .from(schema.aiCreditLedger)
      .where(eq(schema.aiCreditLedger.reason, "refund"));
    // Either the whole refund happened or none of it: no refund row without the credit.
    expect(refunds).toHaveLength(0);
    expect((await getStarterAiStatus(USER_ID)).remaining).toBe(STARTER_LIMIT - 1);

    await testDb.exec("DROP TRIGGER fail_settings_update");
    expect(await refundHostedCredit(USER_ID, { type: "ai_job", id: "job-1" })).toBe(true);
    expect((await getStarterAiStatus(USER_ID)).remaining).toBe(STARTER_LIMIT);
  });

  it("charges each action its cost, from free credits first, then purchased", async () => {
    await setPaidBalance(10);
    expect(await spend("quiz-1", STARTER_LIMIT, "quiz")).toEqual({ starter: 2, paid: 0 });
    expect((await getStarterAiStatus(USER_ID)).remaining).toBe(0);
    expect(await spend("coach-1", STARTER_LIMIT, "coach")).toEqual({ starter: 0, paid: 5 });
    expect(await spend("card-1", STARTER_LIMIT, "card")).toEqual({ starter: 0, paid: 1 });
    expect(await getPaidCreditBalance(USER_ID)).toBe(4);

    const deltas = await getDb().select().from(schema.aiCreditLedger);
    expect(Object.fromEntries(deltas.map((row) => [row.refId, [row.bucket, row.delta]]))).toEqual({
      "quiz-1": ["starter", -2],
      "coach-1": ["paid", -5],
      "card-1": ["paid", -1],
    });

    // Refunds return the full cost to the bucket it came from.
    expect(await refundHostedCredit(USER_ID, { type: "agent_run", id: "coach-1" })).toBe(true);
    expect(await refundHostedCredit(USER_ID, { type: "ai_job", id: "quiz-1" })).toBe(true);
    expect(await getPaidCreditBalance(USER_ID)).toBe(9);
    expect((await getStarterAiStatus(USER_ID)).remaining).toBe(STARTER_LIMIT);
  });

  it("uses up free credits first and takes only the rest from purchased credits", async () => {
    await setPaidBalance(10);
    // 3 free credits left for a 5-credit turn: 3 free + 2 purchased.
    expect(await spend("coach-1", 3, "coach")).toEqual({ starter: 3, paid: 2 });
    expect((await getStarterAiStatus(USER_ID)).used).toBe(3);
    expect(await getPaidCreditBalance(USER_ID)).toBe(8);

    const rows = await getDb()
      .select()
      .from(schema.aiCreditLedger)
      .where(eq(schema.aiCreditLedger.refId, "coach-1"));
    expect(rows.map((row) => [row.reason, row.bucket, row.delta]).sort()).toEqual([
      ["spend", "paid", -2],
      ["spend", "starter", -3],
    ]);
  });

  it("refunds a split spend to both buckets, once", async () => {
    await setPaidBalance(10);
    await spend("coach-1", 3, "coach");
    const ref = { type: "agent_run" as const, id: "coach-1" };
    expect(await refundHostedCredit(USER_ID, ref)).toBe(true);
    expect(await refundHostedCredit(USER_ID, ref)).toBe(false);
    expect((await getStarterAiStatus(USER_ID)).used).toBe(0);
    expect(await getPaidCreditBalance(USER_ID)).toBe(10);
    const refunds = await getDb()
      .select()
      .from(schema.aiCreditLedger)
      .where(eq(schema.aiCreditLedger.reason, "refund"));
    expect(refunds.map((row) => [row.bucket, row.delta]).sort()).toEqual([
      ["paid", 2],
      ["starter", 3],
    ]);
  });

  it("refuses when free and purchased credits together fall short, spending nothing", async () => {
    await setPaidBalance(1);
    // 3 free + 1 purchased = 4 < 5.
    await expect(spend("coach-1", 3, "coach")).rejects.toBeInstanceOf(StarterCreditsExhaustedError);
    expect((await getStarterAiStatus(USER_ID)).used).toBe(0);
    expect(await getPaidCreditBalance(USER_ID)).toBe(1);
    expect(await getDb().select().from(schema.aiCreditLedger)).toHaveLength(0);
  });
});
