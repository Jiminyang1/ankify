import { describe, expect, it } from "vitest";
import { classifyAiJobError } from "./errors";

describe("classifyAiJobError", () => {
  it("does not retry provider request rejections", () => {
    expect(classifyAiJobError(Object.assign(new Error("Bad request"), { status: 400 }))).toMatchObject({
      code: "ai_request_rejected",
      retryable: false,
    });
  });

  it.each([429, 500])("retries transient provider status %s", (status) => {
    expect(classifyAiJobError(Object.assign(new Error("Provider unavailable"), { status }))).toMatchObject({
      code: "ai_provider_unavailable",
      retryable: true,
    });
  });
});
