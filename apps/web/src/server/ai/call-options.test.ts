import { describe, expect, it } from "vitest";
import { aiCallOptions } from "./call-options";

type Provider = "anthropic" | "openai" | "deepseek";
const call = (provider: Provider, model: string, reasoningLevel: string, reasoning: "user" | "lightest" = "user") =>
  aiCallOptions({ provider, model, reasoningLevel }, reasoning).providerOptions;

describe("aiCallOptions", () => {
  it("sends nothing for the default level, so thinking stays at the provider default", () => {
    expect(call("deepseek", "deepseek-flash", "default")).toBeUndefined();
    expect(call("anthropic", "claude-opus-5-5", "default")).toBeUndefined();
    expect(call("openai", "gpt-6-sol", "default")).toBeUndefined();
  });

  it("translates a chosen level into each provider's native option", () => {
    expect(call("deepseek", "deepseek-flash", "off")).toEqual({ deepseek: { thinking: { type: "disabled" } } });
    expect(call("deepseek", "deepseek-flash", "max")).toEqual({
      deepseek: { thinking: { type: "enabled" }, reasoningEffort: "max" },
    });
    expect(call("anthropic", "claude-sonnet-5-5", "xhigh")).toEqual({
      anthropic: { thinking: { type: "adaptive" }, effort: "xhigh" },
    });
    expect(call("openai", "gpt-6-sol", "none")).toEqual({ openai: { reasoningEffort: "none" } });
  });

  it("falls back to the default for levels the model doesn't accept", () => {
    // Astra rejects `none`; Opus 5.5 can't turn thinking off.
    expect(call("openai", "gpt-6-astra", "none")).toBeUndefined();
    expect(call("anthropic", "claude-opus-5-5", "off")).toBeUndefined();
    // Models outside the catalog only get the provider default.
    expect(call("openai", "gpt-custom-finetune", "high")).toBeUndefined();
  });

  it("maps lightest to what each model accepts, ignoring the user's level", () => {
    const lightest = (provider: Provider, model: string) => call(provider, model, "max", "lightest");

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
    expect(lightest("anthropic", "claude-haiku-4-5")).toBeUndefined();

    expect(lightest("openai", "gpt-6-astra")).toEqual({ openai: { reasoningEffort: "low" } });
    expect(lightest("openai", "o3")).toEqual({ openai: { reasoningEffort: "low" } });
    expect(lightest("openai", "gpt-4o-mini")).toBeUndefined();
  });
});
