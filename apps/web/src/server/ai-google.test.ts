import { afterEach, describe, expect, it, vi } from "vitest";
import { aiProviderEnum } from "@ankify/contracts";
import { buildModel, GEMINI_THINKING_HEADROOM_TOKENS, providerCallOptions } from "./ai";
import { listAvailableAiModels } from "./ai-models";

vi.mock("@/server/settings", () => ({
  getAiSettings: vi.fn(async () => ({ encryptedApiKey: null })),
  getAiRuntimeSettings: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());

describe("Google Gemini provider", () => {
  it("is an accepted provider and builds a native Gemini model", () => {
    expect(aiProviderEnum.parse("google")).toBe("google");
    const model = buildModel({ provider: "google", model: "gemini-3.5-flash", apiKey: "k", reasoningMode: "auto" } as never);
    expect(typeof model === "object" && model.provider).toMatch(/^google/);
    expect(typeof model === "object" && model.modelId).toBe("gemini-3.5-flash");
  });

  it("keeps Gemini thinking low and leaves room for it in the output cap", () => {
    expect(providerCallOptions({ provider: "google", model: "gemini-3.8-flash" }, 2_000)).toEqual({
      maxOutputTokens: 2_000 + GEMINI_THINKING_HEADROOM_TOKENS,
      providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
    });
    expect(providerCallOptions({ provider: "google", model: "gemini-2.5-pro" }, 2_000)).toMatchObject({
      providerOptions: { google: { thinkingConfig: { thinkingBudget: 1_024 } } },
    });
    expect(providerCallOptions({ provider: "google", model: "gemini-flash-latest" }, 2_000)).toEqual({
      maxOutputTokens: 2_000 + GEMINI_THINKING_HEADROOM_TOKENS,
    });
    expect(providerCallOptions({ provider: "deepseek", model: "deepseek-v4-flash" }, 2_000)).toEqual({ maxOutputTokens: 2_000 });
  });

  it("lists only Gemini models that generate content, across pages", async () => {
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("gk");
      if (!url.searchParams.get("pageToken")) {
        return Response.json({
          models: [
            { name: "models/gemini-3.5-flash", displayName: "Gemini 3.5 Flash", supportedGenerationMethods: ["generateContent"] },
            { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
            { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
          ],
          nextPageToken: "p2",
        });
      }
      return Response.json({
        models: [{ name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent", "countTokens"] }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listAvailableAiModels("u1", { provider: "google", apiKey: "gk" });
    expect(result).toEqual({
      ok: true,
      provider: "google",
      models: [{ id: "gemini-3.8-flash", label: undefined }, { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports Gemini's 400 for a bad key as a rejected key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { status: "INVALID_ARGUMENT" } }, { status: 400 })));
    const result = await listAvailableAiModels("u1", { provider: "google", apiKey: "bad" });
    expect(result).toMatchObject({ ok: false, code: "invalid_api_key" });
  });
});
