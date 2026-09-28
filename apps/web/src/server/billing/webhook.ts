import type Stripe from "stripe";
import { fulfillCheckoutSessionById, revokeRefundedPurchase } from "./credits";

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Verifies and handles one Stripe webhook delivery. `payload` must be the raw
 * request body: the signature is computed over the exact bytes Stripe sent.
 * Handlers are idempotent because Stripe delivers at least once and in any
 * order. A 5xx asks Stripe to retry the delivery later.
 */
export async function handleStripeWebhook(
  billing: { stripe: Stripe; webhookSecret: string },
  payload: string,
  signature: string | null,
): Promise<WebhookResult> {
  if (!signature) return { status: 400, body: { error: "missing_signature" } };

  let event: Stripe.Event;
  try {
    event = billing.stripe.webhooks.constructEvent(payload, signature, billing.webhookSecret);
  } catch {
    return { status: 400, body: { error: "invalid_signature" } };
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const sessionId = event.data.object.id;
        const result = await fulfillCheckoutSessionById(billing.stripe, sessionId);
        if (result === "invalid" || result === "refunded") {
          console.warn("[billing] checkout session not credited", { sessionId, result });
        }
        break;
      }
      case "charge.refunded": {
        const result = await revokeRefundedPurchase(event.data.object);
        if (result === "partial_ignored" || result === "not_found") {
          console.warn("[billing] refund needs manual review", { chargeId: event.data.object.id, result });
        }
        break;
      }
      default:
        break;
    }
  } catch (error) {
    console.error("[billing] webhook handling failed", {
      eventId: event.id,
      type: event.type,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 500, body: { error: "webhook_failed" } };
  }
  return { status: 200, body: { received: true } };
}
