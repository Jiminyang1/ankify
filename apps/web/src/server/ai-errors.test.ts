import { describe, expect, it } from "vitest";
import { safeErrorForLog } from "./ai-errors";

describe("AI error redaction", () => {
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
