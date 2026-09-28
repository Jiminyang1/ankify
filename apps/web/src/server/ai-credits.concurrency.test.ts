import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@ankify/db";
import { addPaidCredits, getPaidCreditBalance, spendHostedCredit } from "./ai-credits";
import { StarterCreditsExhaustedError } from "./starter-ai";
import { createTestDb } from "./test-db";

// In-process, Promise-based concurrency against one local SQLite file. The
// local libSQL driver is synchronous and opens every transaction with BEGIN
// IMMEDIATE, so contenders fail fast with SQLITE_BUSY instead of interleaving.
// This proves the failure mode is safe (no overspend, no orphaned ledger rows),
// not Turso's server-side serialization. It lives in its own file because a
// SQLITE_BUSY can leave the local connection locked for later tests.
const testDb = createTestDb();
const USER_ID = "user-concurrency";

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values({ id: USER_ID, name: "Test", email: "concurrency@example.com" });
  await getDb().transaction((tx) => addPaidCredits(tx, USER_ID, 3));
});

afterAll(() => testDb.cleanup());

it("concurrent paid spends never exceed the balance", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) =>
      getDb().transaction((tx) =>
        spendHostedCredit(tx, USER_ID, { action: "quiz", ref: { type: "ai_job", id: `job-${i}` }, starterLimit: 0 }),
      ),
    ),
  );
  const succeeded = results.filter((result) => result.status === "fulfilled").length;
  for (const result of results) {
    if (result.status === "rejected") {
      const error = result.reason as Error & { code?: string };
      expect(error instanceof StarterCreditsExhaustedError || /SQLITE_BUSY/.test(`${error.code} ${error.message}`)).toBe(true);
    }
  }
  expect(succeeded).toBeGreaterThanOrEqual(1);
  // A quiz costs 2, so a balance of 3 covers at most one.
  expect(succeeded).toBe(1);
  expect(await getPaidCreditBalance(USER_ID)).toBe(1);
  const spends = await getDb().select().from(schema.aiCreditLedger).where(eq(schema.aiCreditLedger.userId, USER_ID));
  expect(spends).toHaveLength(succeeded);
});
