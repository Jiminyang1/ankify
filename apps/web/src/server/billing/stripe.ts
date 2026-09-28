import Stripe from "stripe";
import { readBillingConfig, type BillingConfig } from "./config";

let client: { secretKey: string; stripe: Stripe } | undefined;

export function getStripe(config: BillingConfig): Stripe {
  if (!client || client.secretKey !== config.secretKey) {
    client = { secretKey: config.secretKey, stripe: new Stripe(config.secretKey) };
  }
  return client.stripe;
}

/** The Stripe client plus config, or null when billing is not configured. */
export function getBilling(): { config: BillingConfig; stripe: Stripe } | null {
  const config = readBillingConfig();
  if (!config) return null;
  return { config, stripe: getStripe(config) };
}
