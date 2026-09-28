import { describe, expect, it } from "vitest";
import { CREDIT_PACKS, findCreditPack, readBillingConfig, stripeKeyMode } from "./config";

const stripeEnv = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_WEBHOOK_SECRET: "whsec_123",
  ANKIFY_STARTER_AI_API_KEY: "sk-ai",
};

describe("readBillingConfig", () => {
  it("is on only with Stripe keys and the hosted AI key", () => {
    expect(readBillingConfig(stripeEnv)).toEqual({ secretKey: "sk_test_123", webhookSecret: "whsec_123", mode: "test" });
    expect(readBillingConfig({ ...stripeEnv, STRIPE_WEBHOOK_SECRET: " " })).toBeNull();
    expect(readBillingConfig({ ...stripeEnv, STRIPE_SECRET_KEY: undefined })).toBeNull();
    expect(readBillingConfig({ ...stripeEnv, ANKIFY_STARTER_AI_API_KEY: undefined })).toBeNull();
    expect(readBillingConfig({ ...stripeEnv, STRIPE_SECRET_KEY: "pk_test_publishable" })).toBeNull();
  });

  it("allows live keys only in production builds that are not Preview", () => {
    const live = { ...stripeEnv, STRIPE_SECRET_KEY: "sk_live_123" };
    expect(readBillingConfig(live)).toBeNull();
    expect(readBillingConfig({ ...live, NODE_ENV: "development" })).toBeNull();
    expect(readBillingConfig({ ...live, NODE_ENV: "production", ANKIFY_DEPLOYMENT_ENV: "preview" })).toBeNull();
    expect(readBillingConfig({ ...live, NODE_ENV: "production" })?.mode).toBe("live");
    expect(readBillingConfig({ ...live, NODE_ENV: "production", ANKIFY_DEPLOYMENT_ENV: "production" })?.mode).toBe("live");
  });

  it("refuses test keys on a declared Production deployment", () => {
    expect(readBillingConfig({ ...stripeEnv, NODE_ENV: "production", ANKIFY_DEPLOYMENT_ENV: "production" })).toBeNull();
    expect(readBillingConfig({ ...stripeEnv, NODE_ENV: "production", ANKIFY_DEPLOYMENT_ENV: "preview" })?.mode).toBe("test");
  });

  it("recognizes secret and restricted key modes", () => {
    expect(stripeKeyMode("sk_live_x")).toBe("live");
    expect(stripeKeyMode("rk_live_x")).toBe("live");
    expect(stripeKeyMode("sk_test_x")).toBe("test");
    expect(stripeKeyMode("rk_test_x")).toBe("test");
    expect(stripeKeyMode("pk_live_x")).toBeNull();
  });
});

describe("credit packs", () => {
  it("sells the published packs", () => {
    expect(CREDIT_PACKS.map((pack) => [pack.id, pack.credits, pack.unitAmount, pack.currency])).toEqual([
      ["credits_100", 100, 499, "usd"],
      ["credits_250", 250, 999, "usd"],
      ["credits_600", 600, 1999, "usd"],
    ]);
  });

  it("looks packs up by id only", () => {
    expect(findCreditPack(CREDIT_PACKS[0]!.id)).toEqual(CREDIT_PACKS[0]);
    expect(findCreditPack("credits_999999")).toBeNull();
  });
});
