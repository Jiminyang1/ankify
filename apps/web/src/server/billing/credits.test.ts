import Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@ankify/db";
import { getPaidCreditBalance } from "../ai-credits";
import { createTestDb } from "../test-db";
import { findCreditPack } from "./config";
import {
  confirmCheckoutReturn,
  createCreditCheckoutSession,
  fulfillCheckoutSession,
  revokeRefundedPurchase,
} from "./credits";
import { handleStripeWebhook } from "./webhook";

// A real Stripe SDK instance: webhook signing and verification run the SDK's
// own HMAC code offline. Only API calls (retrieve/create) are stubbed, and
// every assertion checks resulting database state.
const testDb = createTestDb();
const WEBHOOK_SECRET = "whsec_test_secret";
const stripe = new Stripe("sk_test_offline_fixture");

const USER_ID = "user-billing";
const OTHER_USER_ID = "user-other";

type SessionFixture = {
  paid?: boolean;
  userId?: string;
  refunded?: boolean;
  credits?: string;
};

const sessions = new Map<string, Stripe.Checkout.Session>();

function defineSession(id: string, fixture: SessionFixture = {}) {
  const userId = fixture.userId ?? USER_ID;
  const session = {
    id,
    object: "checkout.session",
    mode: "payment",
    payment_status: fixture.paid === false ? "unpaid" : "paid",
    client_reference_id: userId,
    metadata: { userId, packId: "credits_100", credits: fixture.credits ?? "100" },
    amount_total: 500,
    currency: "usd",
    payment_intent: {
      id: `pi_${id}`,
      object: "payment_intent",
      latest_charge: { id: `ch_${id}`, object: "charge", refunded: fixture.refunded ?? false },
    },
  } as unknown as Stripe.Checkout.Session;
  sessions.set(id, session);
  return session;
}

const retrieve = vi.spyOn(stripe.checkout.sessions, "retrieve");

function signed(event: { type: string; data: { object: Record<string, unknown> } }, id = `evt_${Math.random()}`) {
  const payload = JSON.stringify({ id, object: "event", api_version: "2024-06-20", ...event });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { payload, signature };
}

function deliver(delivery: { payload: string; signature: string | null }) {
  return handleStripeWebhook({ stripe, webhookSecret: WEBHOOK_SECRET }, delivery.payload, delivery.signature);
}

const completed = (sessionId: string) =>
  signed({ type: "checkout.session.completed", data: { object: { id: sessionId, object: "checkout.session" } } });
const asyncSucceeded = (sessionId: string) =>
  signed({ type: "checkout.session.async_payment_succeeded", data: { object: { id: sessionId, object: "checkout.session" } } });
const chargeRefunded = (sessionId: string, refunded = true) =>
  signed({
    type: "charge.refunded",
    data: { object: { id: `ch_${sessionId}`, object: "charge", payment_intent: `pi_${sessionId}`, refunded } },
  });

async function purchases() {
  return getDb().select().from(schema.creditPurchases);
}

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values([
    { id: USER_ID, name: "Test", email: "billing@example.com" },
    { id: OTHER_USER_ID, name: "Other", email: "other@example.com" },
  ]);
});

beforeEach(async () => {
  const db = getDb();
  await testDb.exec("DROP TRIGGER IF EXISTS fail_balance_insert");
  await db.delete(schema.aiCreditLedger);
  await db.delete(schema.aiCreditBalances);
  await db.delete(schema.creditPurchases);
  await db.delete(schema.settings);
  sessions.clear();
  retrieve.mockReset().mockImplementation((async (id: string) => {
    const session = sessions.get(id);
    if (!session) throw new Error(`No such checkout.session: ${id}`);
    return session;
  }) as unknown as typeof stripe.checkout.sessions.retrieve);
});

afterAll(() => testDb.cleanup());

describe("webhook signature verification", () => {
  it("rejects missing, invalid, and re-serialized signatures without side effects", async () => {
    defineSession("cs_1");
    const delivery = completed("cs_1");

    expect((await deliver({ payload: delivery.payload, signature: null })).status).toBe(400);
    expect((await deliver({ payload: delivery.payload, signature: "t=1,v1=deadbeef" })).status).toBe(400);
    // The signature covers the raw bytes: the same JSON re-serialized fails.
    const reformatted = JSON.stringify(JSON.parse(delivery.payload), null, 2);
    expect((await deliver({ payload: reformatted, signature: delivery.signature })).status).toBe(400);
    const signedWithOtherSecret = stripe.webhooks.generateTestHeaderString({
      payload: delivery.payload,
      secret: "whsec_someone_else",
    });
    expect((await deliver({ payload: delivery.payload, signature: signedWithOtherSecret })).status).toBe(400);

    expect(retrieve).not.toHaveBeenCalled();
    expect(await purchases()).toHaveLength(0);
  });

  it("rejects a signed but malformed body and ignores unsupported events", async () => {
    const payload = "{not json";
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    expect((await deliver({ payload, signature })).status).toBe(400);

    const other = signed({ type: "customer.created", data: { object: { id: "cus_1" } } });
    expect(await deliver(other)).toEqual({ status: 200, body: { received: true } });
    expect(await purchases()).toHaveLength(0);
  });
});

describe("webhook fulfillment", () => {
  it("grants a paid Session once across duplicate and sibling events", async () => {
    defineSession("cs_1");
    const delivery = completed("cs_1");

    expect((await deliver(delivery)).status).toBe(200);
    expect((await deliver(delivery)).status).toBe(200);
    expect((await deliver(asyncSucceeded("cs_1"))).status).toBe(200);

    expect(await getPaidCreditBalance(USER_ID)).toBe(100);
    expect(await purchases()).toHaveLength(1);
    const ledger = await getDb().select().from(schema.aiCreditLedger);
    expect(ledger).toMatchObject([{ reason: "purchase", delta: 100, refId: "cs_1" }]);
  });

  it("uses the authoritative Session, not the event payload", async () => {
    defineSession("cs_1", { paid: false });
    // The payload claims "paid", but Stripe says the Session is unpaid.
    const forgedPayload = signed({
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", payment_status: "paid", metadata: { userId: USER_ID, credits: "9999" } } },
    });
    expect((await deliver(forgedPayload)).status).toBe(200);
    expect(await purchases()).toHaveLength(0);

    // Delayed payment method confirms later.
    defineSession("cs_1");
    expect((await deliver(asyncSucceeded("cs_1"))).status).toBe(200);
    expect(await getPaidCreditBalance(USER_ID)).toBe(100);
  });

  it("asks Stripe to retry when the Stripe API fails, then fulfills", async () => {
    defineSession("cs_1");
    retrieve.mockRejectedValueOnce(new Error("stripe unavailable"));
    expect((await deliver(completed("cs_1"))).status).toBe(500);
    expect(await purchases()).toHaveLength(0);

    expect((await deliver(completed("cs_1"))).status).toBe(200);
    expect(await getPaidCreditBalance(USER_ID)).toBe(100);
  });

  it("rolls back a half-finished fulfillment and succeeds on retry", async () => {
    defineSession("cs_1");
    await testDb.exec(
      "CREATE TRIGGER fail_balance_insert BEFORE INSERT ON ai_credit_balances BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );
    expect((await deliver(completed("cs_1"))).status).toBe(500);
    // The purchase row was inserted before the failing balance write; the
    // transaction must have removed it, or the retry would be skipped.
    expect(await purchases()).toHaveLength(0);

    await testDb.exec("DROP TRIGGER fail_balance_insert");
    expect((await deliver(completed("cs_1"))).status).toBe(200);
    expect(await getPaidCreditBalance(USER_ID)).toBe(100);
  });

  it("grants nothing for deleted users, mismatched owners, or bad metadata", async () => {
    defineSession("cs_deleted", { userId: "deleted-user" });
    defineSession("cs_bad", { credits: "-5" });
    const mismatched = defineSession("cs_mismatch");
    (mismatched as { client_reference_id: string }).client_reference_id = OTHER_USER_ID;

    for (const id of ["cs_deleted", "cs_bad", "cs_mismatch"]) {
      expect((await deliver(completed(id))).status).toBe(200);
    }
    expect(await purchases()).toHaveLength(0);
    expect(await getPaidCreditBalance(USER_ID)).toBe(0);
    expect(await getPaidCreditBalance(OTHER_USER_ID)).toBe(0);
  });
});

describe("refunds", () => {
  it("revokes remaining credits once when a fulfilled purchase is refunded", async () => {
    defineSession("cs_1");
    await deliver(completed("cs_1"));
    await getDb().update(schema.aiCreditBalances).set({ balance: 30 }).where(eq(schema.aiCreditBalances.userId, USER_ID));

    const refund = chargeRefunded("cs_1");
    expect((await deliver(refund)).status).toBe(200);
    expect((await deliver(refund)).status).toBe(200);
    expect(await getPaidCreditBalance(USER_ID)).toBe(0);

    const [purchase] = await purchases();
    expect(purchase?.status).toBe("refunded");
    const refunds = await getDb()
      .select()
      .from(schema.aiCreditLedger)
      .where(eq(schema.aiCreditLedger.reason, "stripe_refund"));
    expect(refunds).toMatchObject([{ delta: -30 }]);

    // A late completion event cannot re-grant a refunded purchase.
    expect((await deliver(completed("cs_1"))).status).toBe(200);
    expect(await getPaidCreditBalance(USER_ID)).toBe(0);
  });

  it("never grants a payment refunded before fulfillment (out-of-order events)", async () => {
    // charge.refunded arrives first: nothing to revoke yet.
    expect((await deliver(chargeRefunded("cs_1"))).status).toBe(200);
    // Stripe now reports the payment's charge as refunded.
    defineSession("cs_1", { refunded: true });
    expect((await deliver(completed("cs_1"))).status).toBe(200);
    expect((await deliver(completed("cs_1"))).status).toBe(200);

    expect(await getPaidCreditBalance(USER_ID)).toBe(0);
    const [purchase] = await purchases();
    expect(purchase).toMatchObject({ status: "refunded", credits: 100 });
    expect(await getDb().select().from(schema.aiCreditLedger)).toHaveLength(0);
  });

  it("leaves partial refunds and unknown charges for manual review", async () => {
    defineSession("cs_1");
    await deliver(completed("cs_1"));
    expect(await revokeRefundedPurchase({ payment_intent: "pi_cs_1", refunded: false })).toBe("partial_ignored");
    expect(await revokeRefundedPurchase({ payment_intent: "pi_unknown", refunded: true })).toBe("not_found");
    expect(await getPaidCreditBalance(USER_ID)).toBe(100);
  });

  it("removes credits across purchases because balances are pooled (documented limitation)", async () => {
    defineSession("cs_a");
    defineSession("cs_b");
    await deliver(completed("cs_a"));
    await deliver(completed("cs_b"));
    // 150 of the 200 pooled credits are spent; which purchase they came from
    // is not tracked. Refunding A removes up to A's 100 from what is left.
    await getDb().update(schema.aiCreditBalances).set({ balance: 50 }).where(eq(schema.aiCreditBalances.userId, USER_ID));
    await deliver(chargeRefunded("cs_a"));
    expect(await getPaidCreditBalance(USER_ID)).toBe(0);
  });
});

describe("success redirect", () => {
  it("fulfills only the signed-in user's own paid Session", async () => {
    defineSession("cs_mine");
    defineSession("cs_theirs", { userId: OTHER_USER_ID });
    defineSession("cs_unpaid", { paid: false });

    expect(await confirmCheckoutReturn(stripe, USER_ID, "cs_theirs")).toBeNull();
    expect(await getPaidCreditBalance(OTHER_USER_ID)).toBe(0);
    expect(await confirmCheckoutReturn(stripe, USER_ID, "cs_unpaid")).toBe("pending");
    expect(await confirmCheckoutReturn(stripe, USER_ID, "cs_mine")).toBe("success");
    expect(await confirmCheckoutReturn(stripe, USER_ID, "cs_mine")).toBe("success");
    expect(await getPaidCreditBalance(USER_ID)).toBe(100);

    // Unknown Session id or Stripe outage: no credits, neutral pending notice.
    expect(await confirmCheckoutReturn(stripe, USER_ID, "cs_missing")).toBe("pending");
    expect(await purchases()).toHaveLength(1);
  });

  it("webhook and redirect fulfilling the same Session grant once (sequential interleaving)", async () => {
    defineSession("cs_1");
    expect(await confirmCheckoutReturn(stripe, USER_ID, "cs_1")).toBe("success");
    expect((await deliver(completed("cs_1"))).status).toBe(200);
    expect(await getPaidCreditBalance(USER_ID)).toBe(100);
  });
});

describe("fulfillCheckoutSession input checks", () => {
  it("requires payment mode, paid status, and matching owner metadata", async () => {
    const base = defineSession("cs_x");
    expect(await fulfillCheckoutSession({ ...base, mode: "subscription" })).toBe("unpaid");
    expect(await fulfillCheckoutSession({ ...base, payment_status: "no_payment_required" })).toBe("unpaid");
    expect(await fulfillCheckoutSession({ ...base, metadata: { userId: USER_ID, packId: "p" } })).toBe("invalid");
    expect(await purchases()).toHaveLength(0);
  });
});

describe("checkout session creation", () => {
  it("builds the Session only from server pack data and reuses the per-mode Customer", async () => {
    const create = vi
      .spyOn(stripe.checkout.sessions, "create")
      .mockResolvedValue({ url: "https://checkout.stripe.test/c" } as never);
    const createCustomer = vi
      .spyOn(stripe.customers, "create")
      .mockImplementation((async () => ({ id: `cus_${createCustomer.mock.calls.length}` })) as never);
    const pack = findCreditPack("credits_100")!;
    const user = { id: USER_ID, email: "billing@example.com", name: "Test" };
    const args = { stripe, user, pack, origin: "https://ankify.test", productName: "ankify AI credits (100)" };

    expect(await createCreditCheckoutSession({ ...args, mode: "test" })).toBe("https://checkout.stripe.test/c");
    await createCreditCheckoutSession({ ...args, mode: "test" });
    expect(createCustomer).toHaveBeenCalledTimes(1);

    const params = create.mock.calls[0]![0]!;
    expect(params).toMatchObject({
      mode: "payment",
      customer: "cus_1",
      client_reference_id: USER_ID,
      metadata: { userId: USER_ID, packId: "credits_100", credits: "100" },
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: 499 } }],
      success_url: "https://ankify.test/settings?billing=success&session_id={CHECKOUT_SESSION_ID}#credits",
      cancel_url: "https://ankify.test/settings?billing=cancelled#credits",
    });

    // Switching to live mode must not reuse the test-mode Customer id.
    await createCreditCheckoutSession({ ...args, mode: "live" });
    expect(createCustomer).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[2]![0]!.customer).toBe("cus_2");
    const [row] = await getDb()
      .select()
      .from(schema.settings)
      .where(and(eq(schema.settings.userId, USER_ID), eq(schema.settings.key, "billing")));
    expect(row?.value).toEqual({ customers: { test: "cus_1", live: "cus_2" } });

    create.mockRestore();
    createCustomer.mockRestore();
  });
});
