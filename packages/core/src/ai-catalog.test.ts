import { describe, expect, it } from "vitest";
import { AI_PROVIDERS, getReasoningLevels, normalizeReasoningLevel } from "./ai-catalog";

describe("ai catalog", () => {
  it("lists every provider with at least one suggested model", () => {
    expect(AI_PROVIDERS.map((provider) => provider.id).sort()).toEqual(["anthropic", "deepseek", "openai"]);
    for (const provider of AI_PROVIDERS) expect(provider.models.length).toBeGreaterThan(0);
  });

  it("only offers Off where the model can turn thinking off", () => {
    expect(getReasoningLevels("deepseek", "deepseek-flash")).toContain("off");
    expect(getReasoningLevels("anthropic", "claude-opus-5-5")).not.toContain("off");
    expect(getReasoningLevels("openai", "gpt-6-astra")).not.toContain("none");
    expect(getReasoningLevels("openai", "gpt-6-sol")).toContain("none");
    expect(getReasoningLevels("anthropic", "claude-haiku-4-5")).toEqual([]);
    expect(getReasoningLevels("openai", "not-in-catalog")).toEqual([]);
  });

  it("normalizes unknown or unsupported levels to default", () => {
    expect(normalizeReasoningLevel("deepseek", "deepseek-flash", "max")).toBe("max");
    expect(normalizeReasoningLevel("deepseek", "deepseek-flash", "medium")).toBe("default");
    expect(normalizeReasoningLevel("anthropic", "claude-opus-5-5", "off")).toBe("default");
    expect(normalizeReasoningLevel("openai", "gpt-6-sol", undefined)).toBe("default");
  });
});
