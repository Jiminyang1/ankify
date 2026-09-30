import { beforeEach, describe, expect, it, vi } from "vitest";
import { capabilitiesSchema } from "@ankify/contracts";

const { getRequestUser, rateProblemReview, undoLatestProblemReview } = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  rateProblemReview: vi.fn(),
  undoLatestProblemReview: vi.fn(),
}));
vi.mock("@/server/auth", () => ({
  getRequestUser,
  unauthorizedResponse: () => Response.json({ error: "unauthorized" }, { status: 401 }),
}));
vi.mock("@/server/review-commands", () => ({ rateProblemReview, undoLatestProblemReview }));
import { GET as capabilities } from "../../capabilities/route";
import { POST as undo } from "../undo/route";
import { POST as rate } from "./route";

const post = (handler: (req: Request) => Promise<Response>, body: unknown) =>
  handler(new Request("http://localhost/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  getRequestUser.mockResolvedValue({ id: "user-1" });
  rateProblemReview.mockResolvedValue({ ok: true, idempotentReplay: false, nextDue: null, queue: {} });
  undoLatestProblemReview.mockResolvedValue({ ok: true, queue: {} });
});

describe("legacy review cutover guard", () => {
  it("keeps the legacy rating routes working until the cutover", async () => {
    expect((await post(rate, { problemId: "p1", rating: 3 })).status).toBe(200);
    expect((await post(undo, { problemId: "p1" })).status).toBe(200);
  });

  it("answers old clients with a structured upgrade request once legacy reviews are retired", async () => {
    vi.stubEnv("ANKIFY_DISABLED_WORKFLOWS", "legacy_review");
    for (const response of [await post(rate, { problemId: "p1", rating: 3 }), await post(undo, { problemId: "p1" })]) {
      expect(response.status).toBe(426);
      expect(await response.json()).toMatchObject({ error: "upgrade_required", workflow: "legacy_review" });
    }
    expect(rateProblemReview).not.toHaveBeenCalled();
    expect(undoLatestProblemReview).not.toHaveBeenCalled();

    const advertised = capabilitiesSchema.parse(await (await capabilities(new Request("http://localhost/api/capabilities"))).json());
    expect(advertised.supportedWorkflows).not.toContain("legacy_review");
    expect(advertised.deprecations).toEqual([expect.objectContaining({ workflow: "legacy_review", code: "upgrade_required" })]);
  });

  it("still requires authentication before anything else", async () => {
    getRequestUser.mockResolvedValue(null);
    vi.stubEnv("ANKIFY_DISABLED_WORKFLOWS", "legacy_review");
    expect((await post(rate, { problemId: "p1", rating: 3 })).status).toBe(401);
  });
});
