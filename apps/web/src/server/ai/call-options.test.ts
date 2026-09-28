import { describe, expect, it } from "vitest";
import { aiCallOptions } from "./call-options";

describe("aiCallOptions", () => {
  it("leaves thinking at the provider default for normal calls", () => {
    for (const [provider, model] of [
      ["deepseek", "deepseek-flash"],
      ["anthropic", "claude-opus-5-5"],
      ["openai", "gpt-5"],
    ] as const) {
      expect(aiCallOptions({ provider, model, reasoningMode: "thinking" }, "user")).toEqual({});
    }
  });

  it("honors the legacy Fast switch only where Settings offers it", () => {
    expect(aiCallOptions({ provider: "deepseek", model: "deepseek-flash", reasoningMode: "fast" }, "user")).toEqual({
      providerOptions: { deepseek: { thinking: { type: "disabled" } } },
    });
    // Settings never showed the switch for Anthropic/OpenAI; a stored "fast" there means nothing.
    expect(aiCallOptions({ provider: "anthropic", model: "claude-sonnet-4-6", reasoningMode: "fast" }, "user")).toEqual({});
    expect(aiCallOptions({ provider: "openai", model: "gpt-5", reasoningMode: "fast" }, "user")).toEqual({});
  });

  it("maps lightest to what each model accepts", () => {
    const lightest = (provider: "anthropic" | "openai" | "deepseek", model: string) =>
      aiCallOptions({ provider, model, reasoningMode: "thinking" }, "lightest").providerOptions;

    expect(lightest("deepseek", "deepseek-v4-pro")).toEqual({ deepseek: { thinking: { type: "disabled" } } });

    // Thinking can't be disabled on these: lower effort instead.
    expect(lightest("anthropic", "claude-opus-5-5")).toEqual({ anthropic: { effort: "low" } });
    expect(lightest("anthropic", "claude-sonnet-5-5")).toEqual({ anthropic: { effort: "low" } });
    expect(lightest("anthropic", "claude-fable-5-1")).toEqual({ anthropic: { effort: "low" } });
    // These accept thinking: disabled.
    expect(lightest("anthropic", "claude-opus-5")).toEqual({ anthropic: { thinking: { type: "disabled" } } });
    expect(lightest("anthropic", "claude-sonnet-5")).toEqual({ anthropic: { thinking: { type: "disabled" } } });
    expect(lightest("anthropic", "claude-opus-4-7")).toEqual({ anthropic: { thinking: { type: "disabled" } } });
    expect(lightest("anthropic", "claude-sonnet-4-6")).toEqual({ anthropic: { thinking: { type: "disabled" } } });
    // Haiku 4.5 doesn't think unless asked.
    expect(lightest("anthropic", "claude-haiku-4-5-20251001")).toBeUndefined();

    expect(lightest("openai", "gpt-5")).toEqual({ openai: { reasoningEffort: "low" } });
    expect(lightest("openai", "o3")).toEqual({ openai: { reasoningEffort: "low" } });
    expect(lightest("openai", "gpt-4o-mini")).toBeUndefined();
  });
});
