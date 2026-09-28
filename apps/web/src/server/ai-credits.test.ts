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

    expect(await spend("job-1")).toBe("starter");
    expect(await spend("job-2")).toBe("starter");
    expect(await spend("job-3")).toBe("paid");
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

    expect(await spend("paid-1", 0)).toBe("paid");
    await expect(spend("paid-2", 0)).rejects.toBeInstanceOf(StarterCreditsExhaustedError);
    expect(await getPaidCreditBalance(USER_ID)).toBe(0);
  });

  it("rejects a second spend for the same job", async () => {
    await spend("job-1");
    // The unique ledger index makes a repeated spend fail and roll back.
    await expect(spend("job-1")).rejects.toThrow();
    expect((await getStarterAiStatus(USER_ID)).remaining).toBe(STARTER_LIMIT - 1);
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

  it("charges each action its cost, from free credits when they cover it, else purchased", async () => {
    await setPaidBalance(10);
    expect(await spend("quiz-1", STARTER_LIMIT, "quiz")).toBe("starter");
    expect((await getStarterAiStatus(USER_ID)).remaining).toBe(0);
    expect(await spend("coach-1", STARTER_LIMIT, "coach")).toBe("paid");
    expect(await spend("card-1", STARTER_LIMIT, "card")).toBe("paid");
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

  it("never splits one action across free and purchased credits", async () => {
    await setPaidBalance(3);
    // 3 free + 3 purchased = 6, but neither bucket alone covers a 5-credit turn.
    await expect(spend("coach-1", 3, "coach")).rejects.toBeInstanceOf(StarterCreditsExhaustedError);
    expect((await getStarterAiStatus(USER_ID)).used).toBe(0);
    expect(await getPaidCreditBalance(USER_ID)).toBe(3);
    // The leftover free credits still pay for cheaper actions.
    expect(await spend("quiz-1", 3, "quiz")).toBe("starter");
  });
});
