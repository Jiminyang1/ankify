import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@ankify/db";
import { getRequestSessionUser } from "@/server/auth";
import { createCreditCheckoutSession } from "@/server/billing/credits";
import { getBilling } from "@/server/billing/stripe";
import { createTestDb } from "@/server/test-db";
import { POST } from "./route";

// Route-level checks: authentication, validation, rate limiting (real DB),
// and error shaping. Stripe itself is not called here; session creation is
// covered against the SDK in server/billing/credits.test.ts.
vi.mock("@/server/auth", () => ({
  getRequestSessionUser: vi.fn(),
  unauthorizedResponse: () => Response.json({ error: "unauthorized" }, { status: 401 }),
}));
vi.mock("@/server/billing/stripe", () => ({ getBilling: vi.fn() }));
vi.mock("@/server/billing/credits", () => ({ createCreditCheckoutSession: vi.fn() }));

const testDb = createTestDb();
const user = { id: "user-route", email: "route@example.com", name: "Route" };
const billing = { config: { secretKey: "sk_test_x", webhookSecret: "whsec_x", mode: "test" as const }, stripe: {} };

function post(body: unknown) {
  return POST(
    new Request("https://ankify.test/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values(user);
});

beforeEach(async () => {
  await getDb().delete(schema.settings);
  vi.mocked(getRequestSessionUser).mockReset().mockResolvedValue(user as never);
  vi.mocked(getBilling).mockReset().mockReturnValue(billing as never);
  vi.mocked(createCreditCheckoutSession).mockReset().mockResolvedValue("https://checkout.stripe.test/c");
  // Credit sales are suspended by default (Phase 6B); these tests cover the
  // still-present checkout, re-enabled as an operator would.
  vi.stubEnv("ANKIFY_ENABLED_LEGACY_WORKFLOWS", "credit_checkout");
});
afterEach(() => vi.unstubAllEnvs());

afterAll(() => testDb.cleanup());

describe("POST /api/billing/checkout", () => {
  it("answers that credit sales are suspended, before touching Stripe", async () => {
    vi.unstubAllEnvs();
    const res = await post({ packId: "credits_100" });
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: "workflow_suspended", workflow: "credit_checkout" });
    expect(createCreditCheckoutSession).not.toHaveBeenCalled();
  });

  it("requires a signed-in session", async () => {
    vi.mocked(getRequestSessionUser).mockResolvedValue(null);
    expect((await post({ packId: "credits_100" })).status).toBe(401);
    expect(createCreditCheckoutSession).not.toHaveBeenCalled();
  });

  it("is unavailable when billing is not configured", async () => {
    vi.mocked(getBilling).mockReturnValue(null);
    const res = await post({ packId: "credits_100" });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "billing_disabled" });
  });

  it("rejects malformed bodies, unknown packs, and client-supplied prices", async () => {
    expect((await post("{nope")).status).toBe(400);
    expect((await post({ packId: "credits_999" })).status).toBe(400);
    expect((await post({ packId: "credits_100", credits: 100000, unitAmount: 1 })).status).toBe(400);
    expect(createCreditCheckoutSession).not.toHaveBeenCalled();
  });

  it("creates the Session for the session user with the server's pack", async () => {
    const res = await post({ packId: "credits_250" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.test/c" });
    expect(vi.mocked(createCreditCheckoutSession).mock.calls[0]![0]).toMatchObject({
      mode: "test",
      user: { id: user.id },
      pack: { id: "credits_250", credits: 250, unitAmount: 999, currency: "usd" },
    });
  });

  it("returns a generic error when Stripe fails", async () => {
    vi.mocked(createCreditCheckoutSession).mockRejectedValue(new Error("Invalid API Key provided: sk_test_****"));
    const res = await post({ packId: "credits_100" });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("sk_test");
    expect(body).toMatchObject({ error: "checkout_failed" });
  });

  it("rate limits Session creation per user", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await post({ packId: "credits_100" })).status);
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
