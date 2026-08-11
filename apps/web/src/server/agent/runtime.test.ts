import { describe, expect, it } from "vitest";
import { classifyAgentError } from "./errors";

describe("classifyAgentError", () => {
  it("classifies a cancelled Agent request as an interruption", () => {
    expect(classifyAgentError(new DOMException("aborted", "AbortError"))).toEqual({
      code: "agent_interrupted",
      message: "The Study Coach response was interrupted.",
    });
  });
});
