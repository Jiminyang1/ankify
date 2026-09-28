import { describe, expect, it } from "vitest";
import { readStarterAiConfig } from "./starter-ai";

describe("readStarterAiConfig", () => {
  it("is off without a key", () => {
    expect(readStarterAiConfig({})).toBeNull();
    expect(readStarterAiConfig({ ANKIFY_STARTER_AI_API_KEY: "  " })).toBeNull();
  });

  it("defaults to DeepSeek flash with 20 credits", () => {
    expect(readStarterAiConfig({ ANKIFY_STARTER_AI_API_KEY: "sk-test" })).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      apiKey: "sk-test",
      credits: 20,
    });
  });

  it("accepts overrides", () => {
    expect(
      readStarterAiConfig({
        ANKIFY_STARTER_AI_API_KEY: "sk-test",
        ANKIFY_STARTER_AI_PROVIDER: "openai",
        ANKIFY_STARTER_AI_MODEL: "gpt-5-mini",
        ANKIFY_STARTER_AI_CREDITS: "5",
      }),
    ).toEqual({ provider: "openai", model: "gpt-5-mini", apiKey: "sk-test", credits: 5 });
  });

  it("rejects unknown providers and ignores invalid credit counts", () => {
    expect(
      readStarterAiConfig({ ANKIFY_STARTER_AI_API_KEY: "sk-test", ANKIFY_STARTER_AI_PROVIDER: "gemini" }),
    ).toBeNull();
    expect(
      readStarterAiConfig({ ANKIFY_STARTER_AI_API_KEY: "sk-test", ANKIFY_STARTER_AI_CREDITS: "-3" })?.credits,
    ).toBe(20);
    expect(
      readStarterAiConfig({ ANKIFY_STARTER_AI_API_KEY: "sk-test", ANKIFY_STARTER_AI_CREDITS: "0" })?.credits,
    ).toBe(0);
  });
});
