import { readStarterAiConfig } from "../starter-ai";

/**
 * Paid AI credit packs. Purchased credits run on the same server-owned AI key
 * as starter credits, so billing is off unless Stripe AND the starter key are
 * configured. Self-hosted deployments without these env vars see no billing UI.
 */
export interface BillingConfig {
  secretKey: string;
  webhookSecret: string;
  /** Stripe mode of the secret key; Customers and payments never cross modes. */
  mode: "live" | "test";
}

export function stripeKeyMode(secretKey: string): "live" | "test" | null {
  if (/^(sk|rk)_live_/.test(secretKey)) return "live";
  if (/^(sk|rk)_test_/.test(secretKey)) return "test";
  return null;
}

export function readBillingConfig(env: Record<string, string | undefined> = process.env): BillingConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secretKey || !webhookSecret) return null;
  if (!readStarterAiConfig(env)) return null;
  const mode = stripeKeyMode(secretKey);
  if (!mode) return null;
  // Fail closed on mixed environments: live money only in production builds
  // (never `next dev` or a declared Preview), and never test-mode "payments"
  // granting real credits on a declared Production deployment.
  const deployment = env.ANKIFY_DEPLOYMENT_ENV?.trim();
  if (mode === "live" && (env.NODE_ENV !== "production" || deployment === "preview")) return null;
  if (mode === "test" && deployment === "production") return null;
  return { secretKey, webhookSecret, mode };
}

export interface CreditPack {
  id: string;
  credits: number;
  /** Price in the smallest currency unit (cents). */
  unitAmount: number;
  currency: "usd";
}

/**
 * The server is the only source of pack prices and sizes: checkout sends
 * inline `price_data` built from this table, so the client only names a pack
 * id. A card costs 1 credit, a quiz 2, a Study Coach turn 5 (CREDIT_COST).
 */
export const CREDIT_PACKS: ReadonlyArray<CreditPack> = [
  { id: "credits_100", credits: 100, unitAmount: 499, currency: "usd" },
  { id: "credits_250", credits: 250, unitAmount: 999, currency: "usd" },
  { id: "credits_600", credits: 600, unitAmount: 1999, currency: "usd" },
];

export function findCreditPack(id: string): CreditPack | null {
  return CREDIT_PACKS.find((pack) => pack.id === id) ?? null;
}
