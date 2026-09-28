import { describe, expect, it } from "vitest";
import { normalizeModelId } from "./registry";

describe("normalizeModelId", () => {
  it("maps retired DeepSeek ids to deepseek-flash", () => {
    expect(normalizeModelId("deepseek", "deepseek-v4-flash")).toBe("deepseek-flash");
    expect(normalizeModelId("deepseek", "deepseek-chat")).toBe("deepseek-flash");
    expect(normalizeModelId("deepseek", "deepseek-reasoner")).toBe("deepseek-flash");
  });

  it("keeps current ids and other providers unchanged", () => {
    expect(normalizeModelId("deepseek", "deepseek-v4-pro")).toBe("deepseek-v4-pro");
    expect(normalizeModelId("deepseek", "deepseek-flash")).toBe("deepseek-flash");
    expect(normalizeModelId("openai", "deepseek-v4-flash")).toBe("deepseek-v4-flash");
    expect(normalizeModelId("", "anything")).toBe("anything");
  });
});
