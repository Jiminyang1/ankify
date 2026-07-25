import { afterEach, describe, expect, it, vi } from "vitest";
import { aiRouteErrorResponse, safeErrorForLog } from "./ai-errors";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AI error redaction", () => {
  it("does not return provider messages or credentials to the client", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = aiRouteErrorResponse(
      new Error("provider response included sk-secret-value"),
      { label: "Quiz generation", timeoutMs: 10_000, logPrefix: "[quiz]" },
    );
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(502);
    expect(body).toContain("ai_generation_failed");
    expect(body).not.toContain("sk-secret-value");
    expect(body).not.toContain("provider response included");
  });

  it("keeps known setup errors actionable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = aiRouteErrorResponse(
      new Error("AI_KEY_MISSING: raw internal detail"),
      { label: "AI card generation", timeoutMs: 10_000, logPrefix: "[card]" },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("ai_key_missing");
    expect(body.message).toBe("Add your provider API key in Settings.");
  });

  it("logs only structured metadata, never the error message", () => {
    const details = safeErrorForLog(
      Object.assign(new Error("secret provider body"), {
        code: "PROVIDER_ERROR",
        status: 429,
      }),
    );

    expect(details).toEqual({
      name: "Error",
      code: "PROVIDER_ERROR",
      status: 429,
    });
    expect(JSON.stringify(details)).not.toContain("secret provider body");
  });
});
