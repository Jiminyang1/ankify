import type Stripe from "stripe";
import { getDb, schema } from "@ankify/db";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { addPaidCredits, removePaidCredits } from "../ai-credits";
import type { BillingConfig, CreditPack } from "./config";

/**
 * Credit pack purchases through Stripe Checkout. Checkout's hosted page offers
 * Link, cards, and any wallet enabled in the Stripe Dashboard. Fulfillment is
 * keyed by the Checkout Session id and always re-reads the Session from Stripe,
 * so the webhook and the success redirect can both call it and credits are
 * granted at most once, and never for a payment that was already refunded.
 */
const KEY_BILLING = "billing";

/** Customers exist per Stripe mode; a test-mode id is unknown to live mode. */
type BillingSettings = { customers?: Partial<Record<BillingConfig["mode"], string>> };

type CheckoutUser = { id: string; email: string; name?: string | null };

async function getOrCreateCustomer(stripe: Stripe, mode: BillingConfig["mode"], user: CheckoutUser): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, user.id), eq(schema.settings.key, KEY_BILLING)))
    .limit(1);
  const stored = (row?.value as BillingSettings | undefined) ?? {};
  const existing = stored.customers?.[mode];
  if (existing) return existing;

  // The idempotency key collapses concurrent first checkouts into one Customer.
  const customer = await stripe.customers.create(
    { email: user.email, name: user.name ?? undefined, metadata: { userId: user.id } },
    { idempotencyKey: `ankify-customer-${mode}-${user.id}` },
  );
  const value: BillingSettings = { ...stored, customers: { ...stored.customers, [mode]: customer.id } };
  await db
    .insert(schema.settings)
    .values({ userId: user.id, key: KEY_BILLING, value })
    .onConflictDoUpdate({
      target: [schema.settings.userId, schema.settings.key],
      set: { value, updatedAt: new Date() },
    });
  return customer.id;
}

export async function createCreditCheckoutSession(args: {
  stripe: Stripe;
  mode: BillingConfig["mode"];
  user: CheckoutUser;
  pack: CreditPack;
  origin: string;
  productName: string;
}): Promise<string> {
  const { stripe, user, pack } = args;
  const customer = await getOrCreateCustomer(stripe, args.mode, user);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer,
    client_reference_id: user.id,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: pack.currency,
          unit_amount: pack.unitAmount,
          product_data: { name: args.productName },
        },
      },
    ],
    metadata: { userId: user.id, packId: pack.id, credits: String(pack.credits) },
    payment_intent_data: { metadata: { userId: user.id, packId: pack.id } },
    success_url: `${args.origin}/settings?billing=success&session_id={CHECKOUT_SESSION_ID}#credits`,
    cancel_url: `${args.origin}/settings?billing=cancelled#credits`,
  });
  if (!session.url) throw new Error("Stripe did not return a Checkout URL");
  return session.url;
}

export type FulfillResult = "granted" | "already_fulfilled" | "refunded" | "unpaid" | "invalid";

type FulfillableSession = Pick<
  Stripe.Checkout.Session,
  "id" | "mode" | "payment_status" | "client_reference_id" | "metadata" | "amount_total" | "currency" | "payment_intent"
>;

function parseCredits(value: string | undefined) {
  const credits = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(credits) && credits > 0 ? credits : null;
}

function paymentIntentIdOf(session: FulfillableSession) {
  return typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
}

/** True only when the Session was loaded with `payment_intent.latest_charge` expanded and that charge is fully refunded. */
function isFullyRefunded(session: FulfillableSession) {
  const paymentIntent = session.payment_intent;
  if (!paymentIntent || typeof paymentIntent === "string") return false;
  const charge = paymentIntent.latest_charge;
  return Boolean(charge && typeof charge !== "string" && charge.refunded);
}

/**
 * Grants a paid Checkout Session's credits once. The unique Checkout Session
 * id on credit_purchases turns every repeat (webhook retries, the success
 * redirect racing the webhook) into a no-op. A payment already fully refunded
 * when fulfillment first runs (refund event delivered before fulfillment) is
 * recorded as a refunded purchase without credits, so it can never be granted
 * later either.
 */
export async function fulfillCheckoutSession(session: FulfillableSession): Promise<FulfillResult> {
  if (session.mode !== "payment" || session.payment_status !== "paid") return "unpaid";
  const userId = session.metadata?.userId;
  const packId = session.metadata?.packId;
  const credits = parseCredits(session.metadata?.credits);
  if (!userId || userId !== session.client_reference_id || !packId || !credits) return "invalid";

  const db = getDb();
  const [owner] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  if (!owner) return "invalid";

  const refunded = isFullyRefunded(session);
  return db.transaction(async (tx) => {
    const now = new Date();
    const inserted = await tx
      .insert(schema.creditPurchases)
      .values({
        id: nanoid(16),
        userId,
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: paymentIntentIdOf(session),
        packId,
        credits,
        amountTotal: session.amount_total ?? 0,
        currency: session.currency ?? "usd",
        status: refunded ? "refunded" : "paid",
        refundedAt: refunded ? now : null,
      })
      .onConflictDoNothing()
      .returning({ id: schema.creditPurchases.id });
    if (inserted.length === 0) return "already_fulfilled";
    if (refunded) return "refunded";

    await addPaidCredits(tx, userId, credits);
    await tx.insert(schema.aiCreditLedger).values({
      id: nanoid(16),
      userId,
      bucket: "paid",
      delta: credits,
      reason: "purchase",
      refType: "checkout_session",
      refId: session.id,
    });
    return "granted";
  });
}

/**
 * Loads the authoritative Checkout Session (never the webhook payload or the
 * redirect) and fulfills it. `expectedUserId` restricts the success redirect to
 * the signed-in user's own Session. Stripe API errors propagate so the webhook
 * can ask Stripe to retry.
 */
export async function fulfillCheckoutSessionById(
  stripe: Stripe,
  sessionId: string,
  options: { expectedUserId?: string } = {},
): Promise<FulfillResult> {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent.latest_charge"],
  });
  if (options.expectedUserId && session.client_reference_id !== options.expectedUserId) return "invalid";
  return fulfillCheckoutSession(session);
}

/**
 * Handles the browser's return from Checkout. Stripe recommends fulfilling
 * here as well as in the webhook, so credits appear even if the webhook is
 * slow. A Session that is not the signed-in user's shows no notice.
 */
export async function confirmCheckoutReturn(
  stripe: Stripe,
  userId: string,
  sessionId: string,
): Promise<"success" | "pending" | null> {
  try {
    const result = await fulfillCheckoutSessionById(stripe, sessionId, { expectedUserId: userId });
    if (result === "granted" || result === "already_fulfilled") return "success";
    if (result === "unpaid") return "pending";
    return null;
  } catch (error) {
    console.error("[billing] checkout return failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return "pending";
  }
}

export type RefundResult = "revoked" | "not_found" | "already_refunded" | "partial_ignored";

/**
 * A fully refunded purchase takes back its credits, never below zero (credits
 * already spent stay spent). Partial refunds are left for manual adjustment.
 */
export async function revokeRefundedPurchase(
  charge: Pick<Stripe.Charge, "payment_intent" | "refunded">,
): Promise<RefundResult> {
  const paymentIntentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) return "not_found";
  if (!charge.refunded) return "partial_ignored";

  return getDb().transaction(async (tx) => {
    const now = new Date();
    const [purchase] = await tx
      .update(schema.creditPurchases)
      .set({ status: "refunded", refundedAt: now })
      .where(
        and(
          eq(schema.creditPurchases.stripePaymentIntentId, paymentIntentId),
          eq(schema.creditPurchases.status, "paid"),
        ),
      )
      .returning();
    if (!purchase) {
      const [existing] = await tx
        .select({ id: schema.creditPurchases.id })
        .from(schema.creditPurchases)
        .where(eq(schema.creditPurchases.stripePaymentIntentId, paymentIntentId))
        .limit(1);
      return existing ? "already_refunded" : "not_found";
    }

    const removed = await removePaidCredits(tx, purchase.userId, purchase.credits);
    await tx
      .insert(schema.aiCreditLedger)
      .values({
        id: nanoid(16),
        userId: purchase.userId,
        bucket: "paid",
        delta: -removed,
        reason: "stripe_refund",
        refType: "checkout_session",
        refId: purchase.stripeCheckoutSessionId,
      })
      .onConflictDoNothing();
    return "revoked";
  });
}

export async function listCreditPurchases(userId: string, limit = 20) {
  return getDb()
    .select({
      id: schema.creditPurchases.id,
      credits: schema.creditPurchases.credits,
      amountTotal: schema.creditPurchases.amountTotal,
      currency: schema.creditPurchases.currency,
      status: schema.creditPurchases.status,
      createdAt: schema.creditPurchases.createdAt,
    })
    .from(schema.creditPurchases)
    .where(eq(schema.creditPurchases.userId, userId))
    .orderBy(desc(schema.creditPurchases.createdAt))
    .limit(limit);
}
