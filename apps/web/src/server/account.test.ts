import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@ankify/db";
import { deleteAccount } from "./account";
import { addPaidCredits } from "./ai-credits";
import { createTestDb } from "./test-db";

const testDb = createTestDb();
const USER_ID = "user-delete";

async function userExists() {
  return (await getDb().select().from(schema.user).where(eq(schema.user.id, USER_ID))).length === 1;
}

async function seedPurchase(credits: number) {
  await getDb().insert(schema.creditPurchases).values({
    id: `purchase-${credits}`,
    userId: USER_ID,
    stripeCheckoutSessionId: `cs_${credits}`,
    stripePaymentIntentId: `pi_${credits}`,
    packId: "credits_100",
    credits,
    amountTotal: 499,
    currency: "usd",
  });
  await getDb().insert(schema.aiCreditLedger).values({
    id: `ledger-${credits}`,
    userId: USER_ID,
    bucket: "paid",
    delta: credits,
    reason: "purchase",
    refType: "checkout_session",
    refId: `cs_${credits}`,
  });
  await getDb().transaction((tx) => addPaidCredits(tx, USER_ID, credits));
}

beforeAll(() => testDb.migrate());

beforeEach(async () => {
  const db = getDb();
  await db.delete(schema.user);
  await db.delete(schema.creditPurchases);
  await db.delete(schema.aiCreditLedger);
  await db.insert(schema.user).values({ id: USER_ID, name: "Test", email: "delete@example.com" });
});

afterAll(() => testDb.cleanup());

describe("account deletion and purchased credits", () => {
  it("deletes an account without purchased credits, no acknowledgement needed", async () => {
    expect(await deleteAccount(USER_ID, { acknowledgeCreditForfeit: false })).toEqual({ ok: true, forfeitedCredits: 0 });
    expect(await userExists()).toBe(false);
    expect(await getDb().select().from(schema.aiCreditLedger)).toHaveLength(0);
  });

  it("refuses to delete without acknowledging the forfeit, changing nothing", async () => {
    await seedPurchase(100);
    expect(await deleteAccount(USER_ID, { acknowledgeCreditForfeit: false })).toEqual({
      ok: false,
      error: "credit_forfeit_unacknowledged",
      paidBalance: 100,
    });
    expect(await userExists()).toBe(true);
    expect(await getDb().select().from(schema.aiCreditBalances)).toMatchObject([{ balance: 100 }]);
  });

  it("forfeits credits on acknowledged deletion and keeps purchase and ledger records", async () => {
    await seedPurchase(100);
    expect(await deleteAccount(USER_ID, { acknowledgeCreditForfeit: true })).toEqual({ ok: true, forfeitedCredits: 100 });

    expect(await userExists()).toBe(false);
    // The balance goes with the account; nothing can restore it.
    expect(await getDb().select().from(schema.aiCreditBalances)).toHaveLength(0);
    // Financial records stay, keyed by the former user id.
    expect(await getDb().select().from(schema.creditPurchases)).toMatchObject([{ userId: USER_ID, credits: 100 }]);
    const ledger = await getDb().select().from(schema.aiCreditLedger);
    expect(ledger.map((row) => [row.reason, row.delta, row.refType])).toEqual(
      expect.arrayContaining([
        ["purchase", 100, "checkout_session"],
        ["forfeit", -100, "account"],
      ]),
    );
  });

  it("a later sign-up with the same email starts with no purchased credits", async () => {
    await seedPurchase(100);
    await deleteAccount(USER_ID, { acknowledgeCreditForfeit: true });
    await getDb().insert(schema.user).values({ id: "user-new", name: "Again", email: "delete@example.com" });
    expect(await getDb().select().from(schema.aiCreditBalances)).toHaveLength(0);
  });

  it("reports a missing account", async () => {
    expect(await deleteAccount("nobody", { acknowledgeCreditForfeit: true })).toEqual({
      ok: false,
      error: "account_not_found",
    });
  });
});
