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
  it("reports only implemented workflows, lists the suspended legacy ones, and has automatic analysis on unless the operator switches it off", async () => {
    getRequestUser.mockResolvedValue({ id: "user-1" });
    const response = await GET(new Request("http://localhost/api/capabilities"));
    const payload = capabilitiesSchema.parse(await response.json());
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(payload.supportedWorkflows).toEqual(["capture", "legacy_review", "practice_sessions", "session_rating", "session_analysis", "suggestions"]);
    expect(payload.sessionAnalysis).toEqual({ available: true, automaticAvailable: true, requiresOwnKey: true });
    expect(payload.deprecations.map(({ workflow, code }) => [workflow, code])).toEqual([
      ["coach", "workflow_suspended"],
      ["card_generation", "workflow_suspended"],
      ["quiz_generation", "workflow_suspended"],
      ["credit_checkout", "workflow_suspended"],
    ]);
    vi.stubEnv("ANKIFY_AUTOMATIC_ANALYSIS", "disabled");
    try {
      const off = capabilitiesSchema.parse(await (await GET(new Request("http://localhost/api/capabilities"))).json());
      expect(off.sessionAnalysis).toEqual({ available: true, automaticAvailable: false, requiresOwnKey: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("re-enables a suspended legacy workflow only when the operator names it", async () => {
    getRequestUser.mockResolvedValue({ id: "user-1" });
    try {
      vi.stubEnv("ANKIFY_ENABLED_LEGACY_WORKFLOWS", " coach , practice_sessions");
      const payload = capabilitiesSchema.parse(await (await GET(new Request("http://localhost/api/capabilities"))).json());
      expect(payload.supportedWorkflows).toContain("coach");
      expect(payload.supportedWorkflows).not.toContain("card_generation");
      expect(payload.deprecations.map((item) => item.workflow)).toEqual(["card_generation", "quiz_generation", "credit_checkout"]);
      vi.stubEnv("ANKIFY_DISABLED_WORKFLOWS", "coach");
      expect(capabilitiesSchema.parse(await (await GET(new Request("http://localhost/api/capabilities"))).json()).supportedWorkflows).not.toContain("coach");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("advertises automatic analysis only once dispatch recovery is enabled, and none when analysis is off", async () => {
    getRequestUser.mockResolvedValue({ id: "user-1" });
    const analysis = async () => capabilitiesSchema.parse(await (await GET(new Request("http://localhost/api/capabilities"))).json()).sessionAnalysis;
    try {
      vi.stubEnv("ANKIFY_AUTOMATIC_ANALYSIS", "enabled");
      expect(await analysis()).toEqual({ available: true, automaticAvailable: true, requiresOwnKey: true });
      vi.stubEnv("ANKIFY_DISABLED_WORKFLOWS", "session_analysis");
      expect(await analysis()).toEqual({ available: false, automaticAvailable: false, requiresOwnKey: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("stops advertising a workflow switched off by the operator", async () => {
    getRequestUser.mockResolvedValue({ id: "user-1" });
    vi.stubEnv("ANKIFY_DISABLED_WORKFLOWS", " practice_sessions , not_a_workflow");
    try {
      const payload = capabilitiesSchema.parse(await (await GET(new Request("http://localhost/api/capabilities"))).json());
      expect(payload.supportedWorkflows).not.toContain("practice_sessions");
      expect(payload.supportedWorkflows).toContain("capture");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
