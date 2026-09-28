import Stripe from "stripe";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { getDb, schema } from "@ankify/db";
import { getPaidCreditBalance } from "../ai-credits";
import { createTestDb } from "../test-db";
import { confirmCheckoutReturn } from "./credits";
import { handleStripeWebhook } from "./webhook";

// In-process simulation of the success redirect racing duplicate webhook
// deliveries for one Session (see ai-credits.concurrency.test.ts for why this
// lives in its own file and what it does and does not prove).
const testDb = createTestDb();
const WEBHOOK_SECRET = "whsec_test_secret";
const stripe = new Stripe("sk_test_offline_fixture");
const USER_ID = "user-race";

const session = {
  id: "cs_race",
  object: "checkout.session",
  mode: "payment",
  payment_status: "paid",
  client_reference_id: USER_ID,
  metadata: { userId: USER_ID, packId: "credits_100", credits: "100" },
  amount_total: 500,
  currency: "usd",
  payment_intent: { id: "pi_race", latest_charge: { id: "ch_race", refunded: false } },
};
vi.spyOn(stripe.checkout.sessions, "retrieve").mockResolvedValue(session as never);

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values({ id: USER_ID, name: "Test", email: "race@example.com" });
});

afterAll(() => testDb.cleanup());

it("grants a Session exactly once when redirect and webhooks race", async () => {
  const payload = JSON.stringify({
    id: "evt_race",
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: "cs_race", object: "checkout.session" } },
  });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const webhook = () => handleStripeWebhook({ stripe, webhookSecret: WEBHOOK_SECRET }, payload, signature);

  const [w1, w2, w3, redirect] = await Promise.all([
    webhook(),
    webhook(),
    webhook(),
    confirmCheckoutReturn(stripe, USER_ID, "cs_race"),
  ]);
  // Losers either saw the purchase (200 / success) or hit SQLITE_BUSY (500 →
  // Stripe retries; redirect shows the neutral pending notice).
  for (const result of [w1, w2, w3]) expect([200, 500]).toContain(result.status);
  expect(["success", "pending"]).toContain(redirect);

  expect(await getPaidCreditBalance(USER_ID)).toBe(100);
  expect(await getDb().select().from(schema.creditPurchases)).toHaveLength(1);
  expect(await getDb().select().from(schema.aiCreditLedger)).toHaveLength(1);
});
