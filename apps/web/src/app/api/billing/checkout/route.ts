import { NextResponse } from "next/server";
import { creditCheckoutRequestSchema } from "@ankify/contracts";
import { getSiteUrl } from "@/lib/site-url";
import { getRequestSessionUser, unauthorizedResponse } from "@/server/auth";
import { isWorkflowEnabled, legacyWorkflowResponse } from "@/server/features";
import { findCreditPack } from "@/server/billing/config";
import { createCreditCheckoutSession } from "@/server/billing/credits";
import { getBilling } from "@/server/billing/stripe";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();
  if (!isWorkflowEnabled("credit_checkout")) return legacyWorkflowResponse("credit_checkout");

  const billing = getBilling();
  if (!billing) {
    return NextResponse.json(
      { error: "billing_disabled", message: "Buying AI credits is not available on this server." },
      { status: 404 },
    );
  }

  const body = await readJsonBody(req, 1_000);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
  const parsed = creditCheckoutRequestSchema.safeParse(body.value);
  const pack = parsed.success ? findCreditPack(parsed.data.packId) : null;
  if (!pack) return NextResponse.json({ error: "invalid_pack" }, { status: 400 });

  const limit = await checkRateLimit(user.id, "billing", RATE_LIMITS.billing);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);

  try {
    const url = await createCreditCheckoutSession({
      stripe: billing.stripe,
      mode: billing.config.mode,
      user,
      pack,
      origin: getSiteUrl(),
      productName: `ankify AI credits (${pack.credits})`,
    });
    return NextResponse.json({ url });
  } catch (error) {
    console.error("[billing] checkout failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "checkout_failed", message: "Could not start checkout. Try again." },
      { status: 502 },
    );
  }
}
