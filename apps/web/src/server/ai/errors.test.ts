import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { classifyProviderFailure, isTransientProviderFailure } from "./errors";
import { ProviderHttpError } from "./providers/types";

function apiError(statusCode: number | undefined, message = "provider error") {
  return new APICallError({
    message,
    url: "https://api.example.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
  });
}

describe("classifyProviderFailure", () => {
  it("classifies by HTTP status", () => {
    expect(classifyProviderFailure(apiError(401))).toBe("invalid_api_key");
    expect(classifyProviderFailure(apiError(402))).toBe("quota_exceeded");
    expect(classifyProviderFailure(apiError(403))).toBe("forbidden");
    expect(classifyProviderFailure(apiError(404))).toBe("model_not_found");
    expect(classifyProviderFailure(apiError(429))).toBe("rate_limited");
    expect(classifyProviderFailure(apiError(503))).toBe("provider_unavailable");
    expect(classifyProviderFailure(apiError(400))).toBe("bad_request");
    expect(classifyProviderFailure(new ProviderHttpError(401))).toBe("invalid_api_key");
  });

  it("recognizes unknown-model 400s", () => {
    expect(classifyProviderFailure(apiError(400, "Model Not Exist"))).toBe("model_not_found");
    expect(
      classifyProviderFailure(
        apiError(400, "The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed x."),
      ),
    ).toBe("model_not_found");
  });

  it("recognizes timeouts and network failures", () => {
    expect(classifyProviderFailure(new DOMException("aborted", "AbortError"))).toBe("timeout");
    expect(classifyProviderFailure(apiError(undefined, "Cannot connect to API"))).toBe("network");
    expect(classifyProviderFailure(new TypeError("fetch failed"))).toBe("network");
    expect(classifyProviderFailure(new Error("something else"))).toBe("unknown");
  });

  it("marks only transient failures as retryable", () => {
    expect(isTransientProviderFailure("rate_limited")).toBe(true);
    expect(isTransientProviderFailure("provider_unavailable")).toBe(true);
    expect(isTransientProviderFailure("invalid_api_key")).toBe(false);
    expect(isTransientProviderFailure("quota_exceeded")).toBe(false);
  });
});
