import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@ankify/db";
import { getStarterAiStatus } from "../starter-ai";
import { createTestDb, tableSql } from "../test-db";

// Upgrade path for databases created before the credit feature: at 0016 with
// representative existing data, then every newer migration, as
// `pnpm db:migrate` / `pnpm dev:qa` would apply them.
const testDb = createTestDb();
process.env.ANKIFY_STARTER_AI_API_KEY = "sk-starter-test";
process.env.ANKIFY_STARTER_AI_CREDITS = "20";

beforeAll(async () => {
  await testDb.migrate({ through: "0016_" });
});

afterAll(() => testDb.cleanup());

it("upgrades from 0016 without touching existing users, jobs, or starter usage", async () => {
  const db = getDb();
  expect(await tableSql("credit_purchases")).toBeNull();

  // Data written under 0016 (raw SQL: the current Drizzle schema is newer).
  await testDb.exec(`
    INSERT INTO user (id, name, email) VALUES ('existing-user', 'Existing', 'existing@example.com');
    INSERT INTO settings (user_id, key, value) VALUES ('existing-user', 'starter-ai-usage', json('{"used":7}'));
    INSERT INTO problems (id, user_id, leetcode_slug, title, difficulty, url)
      VALUES ('existing-problem', 'existing-user', 'coin-change', 'Coin Change', 'Medium', 'https://leetcode.com/problems/coin-change/');
    INSERT INTO ai_jobs (id, user_id, problem_id, kind, action, status, idempotency_key, input_envelope,
                         provider, model, reasoning_mode, generation_language)
      VALUES ('existing-job', 'existing-user', 'existing-problem', 'quiz', 'quiz_generate', 'succeeded',
              'existing-request', json('{"v":1,"iv":"x","ciphertext":"x"}'), 'deepseek', 'deepseek-v4-flash', 'fast', 'en');
  `);

  await testDb.migrate();

  expect(await db.select().from(schema.user)).toHaveLength(1);
  expect(await db.select().from(schema.aiJobs).where(eq(schema.aiJobs.id, "existing-job"))).toHaveLength(1);
  expect((await getStarterAiStatus("existing-user")).used).toBe(7);

  // Final constraints: the balance cascades with the user; ledger and
  // purchases keep no FK so they survive account deletion.
  expect(await tableSql("ai_credit_balances")).toMatch(/REFERENCES `user`/);
  expect(await tableSql("ai_credit_ledger")).not.toMatch(/REFERENCES/);
  expect(await tableSql("credit_purchases")).not.toMatch(/REFERENCES/);

  const purchase = {
    id: "p1",
    userId: "existing-user",
    stripeCheckoutSessionId: "cs_1",
    packId: "credits_100",
    credits: 100,
    amountTotal: 499,
    currency: "usd",
  };
  await db.insert(schema.creditPurchases).values(purchase);
  await expect(db.insert(schema.creditPurchases).values({ ...purchase, id: "p2" })).rejects.toThrow();
  await db.delete(schema.user).where(eq(schema.user.id, "existing-user"));
  expect(await db.select().from(schema.creditPurchases)).toHaveLength(1);

  // Re-running migrations is a no-op.
  await testDb.migrate();
  expect(await db.select().from(schema.creditPurchases)).toHaveLength(1);
});
