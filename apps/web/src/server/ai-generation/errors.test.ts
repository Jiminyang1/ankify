import { describe, expect, it } from "vitest";
import { classifyAiJobError } from "./errors";

const withStatus = (status: number, extra: Record<string, unknown> = {}) => Object.assign(new Error(`HTTP ${status}`), { statusCode: status, ...extra });

describe("AI job error classification", () => {
  it("never retries a rejected key, with or without a status code", () => {
    for (const error of [
      withStatus(401),
      withStatus(403),
      Object.assign(new Error("Incorrect API key provided: sk-..."), { name: "AI_APICallError" }),
      Object.assign(new Error("API key is missing."), { name: "AI_LoadAPIKeyError" }),
      new Error("Authentication Fails (governor)"),
    ]) {
      expect(classifyAiJobError(error)).toMatchObject({ code: "ai_request_rejected", retryable: false });
    }
  });

  it("retries rate limits and outages, waiting at least the provider's Retry-After", () => {
    expect(classifyAiJobError(withStatus(429, { responseHeaders: { "retry-after": "45" } }))).toMatchObject({
      code: "ai_provider_unavailable",
      retryable: true,
      retryAfterSeconds: 45,
    });
    expect(classifyAiJobError(withStatus(503))).toMatchObject({ code: "ai_provider_unavailable", retryable: true, retryAfterSeconds: null });
    // An empty account is not a rate limit: retrying cannot help.
    expect(classifyAiJobError(withStatus(429, { responseBody: '{"error":{"code":"credit_balance_exhausted","type":"insufficient_quota"}}' })))
      .toMatchObject({ code: "ai_quota_exceeded", retryable: false });
    expect(classifyAiJobError(withStatus(400))).toMatchObject({ code: "ai_request_rejected", retryable: false });
  });
});
