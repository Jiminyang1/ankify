import { beforeEach, describe, expect, it, vi } from "vitest";
import { capabilitiesSchema } from "@ankify/contracts";

const { getRequestUser } = vi.hoisted(() => ({ getRequestUser: vi.fn() }));
vi.mock("@/server/auth", () => ({
  getRequestUser,
  unauthorizedResponse: () => Response.json({ error: "unauthorized" }, { status: 401 }),
}));
import { GET } from "./route";

beforeEach(() => vi.clearAllMocks());
describe("capabilities handshake", () => {
  it("requires authentication even when called without the proxy", async () => {
    getRequestUser.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api/capabilities"))).status).toBe(401);
  });
  it("reports only implemented workflows and disables session analysis", async () => {
    getRequestUser.mockResolvedValue({ id: "user-1" });
    const response = await GET(new Request("http://localhost/api/capabilities"));
    const payload = capabilitiesSchema.parse(await response.json());
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(payload.supportedWorkflows).toEqual(["capture", "legacy_review", "coach", "card_generation", "quiz_generation", "credit_checkout"]);
    expect(payload.sessionAnalysis).toEqual({ available: false, automaticAvailable: false, requiresOwnKey: true });
    expect(payload.deprecations).toEqual([]);
  });
});
