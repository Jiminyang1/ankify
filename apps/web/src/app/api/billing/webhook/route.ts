import { NextResponse } from "next/server";
import { getBilling } from "@/server/billing/stripe";
import { handleStripeWebhook } from "@/server/billing/webhook";

export const runtime = "nodejs";

/**
 * Stripe webhook. Public in proxy.ts: authenticity comes from the signature
 * over the raw body, not a session cookie.
 */
export async function POST(req: Request) {
  const billing = getBilling();
  if (!billing) return NextResponse.json({ error: "billing_disabled" }, { status: 404 });

  const result = await handleStripeWebhook(
    { stripe: billing.stripe, webhookSecret: billing.config.webhookSecret },
    await req.text(),
    req.headers.get("stripe-signature"),
  );
  return NextResponse.json(result.body, { status: result.status });
}
