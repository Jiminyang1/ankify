import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@ankify/db";
import { deleteAccount } from "../account";
import { createTestDb, tableSql } from "../test-db";

// Upgrade path for databases that already applied 0017 (credit tables with a
// cascading FK to user), such as local QA databases created during
// development of the feature. 0018 rebuilds the ledger and purchases without
// the FK and must keep every row.
const testDb = createTestDb();

beforeAll(async () => {
  await testDb.migrate({ through: "0017_" });
});

afterAll(() => testDb.cleanup());

it("drops the ledger and purchase FKs while keeping all credit data", async () => {
  const db = getDb();
  expect(await tableSql("credit_purchases")).toMatch(/REFERENCES `user`/);

  // Data written under 0017 (raw SQL: the current Drizzle schema is newer).
  await testDb.exec(`
    INSERT INTO user (id, name, email) VALUES ('qa-user', 'QA', 'qa@example.com');
    INSERT INTO ai_credit_balances (user_id, balance) VALUES ('qa-user', 350);
    INSERT INTO credit_purchases (id, user_id, stripe_checkout_session_id, stripe_payment_intent_id, pack_id, credits, amount_total, currency)
      VALUES ('p1', 'qa-user', 'cs_1', 'pi_1', 'credits_100', 100, 500, 'usd'),
             ('p2', 'qa-user', 'cs_2', 'pi_2', 'credits_250', 250, 1000, 'usd');
    INSERT INTO ai_credit_ledger (id, user_id, bucket, delta, reason, ref_type, ref_id)
      VALUES ('l1', 'qa-user', 'paid', 100, 'purchase', 'checkout_session', 'cs_1'),
             ('l2', 'qa-user', 'paid', 250, 'purchase', 'checkout_session', 'cs_2');
  `);

  await testDb.migrate();

  expect(await tableSql("ai_credit_ledger")).not.toMatch(/REFERENCES/);
  expect(await tableSql("credit_purchases")).not.toMatch(/REFERENCES/);
  expect(await tableSql("ai_credit_balances")).toMatch(/REFERENCES `user`/);
  expect((await db.select().from(schema.creditPurchases)).map((row) => row.stripeCheckoutSessionId).sort()).toEqual([
    "cs_1",
    "cs_2",
  ]);
  expect(await db.select().from(schema.aiCreditLedger)).toHaveLength(2);
  expect(await db.select().from(schema.aiCreditBalances)).toMatchObject([{ userId: "qa-user", balance: 350 }]);

  // Indexes were recreated: idempotency still holds after the rebuild.
  await expect(
    testDb.exec(
      "INSERT INTO credit_purchases (id, user_id, stripe_checkout_session_id, pack_id, credits, amount_total, currency) VALUES ('p3', 'qa-user', 'cs_1', 'x', 1, 1, 'usd')",
    ),
  ).rejects.toThrow();
  await expect(
    testDb.exec(
      "INSERT INTO ai_credit_ledger (id, user_id, bucket, delta, reason, ref_type, ref_id) VALUES ('l3', 'qa-user', 'paid', 1, 'purchase', 'checkout_session', 'cs_1')",
    ),
  ).rejects.toThrow();

  // Deleting the account now forfeits the balance and keeps the records.
  expect(await deleteAccount("qa-user", { acknowledgeCreditForfeit: true })).toEqual({ ok: true, forfeitedCredits: 350 });
  expect(await db.select().from(schema.aiCreditBalances)).toHaveLength(0);
  expect(await db.select().from(schema.creditPurchases)).toHaveLength(2);
  const forfeit = await db.select().from(schema.aiCreditLedger).where(eq(schema.aiCreditLedger.reason, "forfeit"));
  expect(forfeit).toMatchObject([{ userId: "qa-user", delta: -350, refType: "account" }]);

  // Idempotent re-run.
  await testDb.migrate();
  expect(await db.select().from(schema.creditPurchases)).toHaveLength(2);
});
