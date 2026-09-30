import { afterEach, describe, expect, it, vi } from "vitest";

const PRODUCTION_ORIGIN = "https://ankify-pi.vercel.app";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadStorage(storedSettings: Record<string, unknown> | undefined) {
  const get = vi.fn().mockResolvedValue({
    "ankify.settings": storedSettings,
  });
  const set = vi.fn().mockResolvedValue(undefined);

  vi.stubGlobal("__ANKIFY_DEFAULT_API_ORIGIN__", PRODUCTION_ORIGIN);
  vi.stubGlobal("chrome", {
    storage: {
      local: { get, set },
    },
  });

  const storage = await import("./storage");
  return { ...storage, get, set };
}

describe("extension settings", () => {
  it("uses the build origin and removes legacy connection data and retired preferences", async () => {
    const { getSettings, set } = await loadStorage({
      apiBaseUrl: "https://custom.example",
      apiToken: "legacy-secret",
      language: "zh",
      resetCodeOnProblemOpen: true,
    });

    await expect(getSettings()).resolves.toEqual({
      apiBaseUrl: PRODUCTION_ORIGIN,
      language: "zh",
    });
    expect(set).toHaveBeenCalledWith({
      "ankify.settings": {
        language: "zh",
      },
    });
  });

  it("never persists an API origin supplied as a user preference", async () => {
    const { setSettings, set } = await loadStorage({
      language: "en",
    });

    await setSettings({
      apiBaseUrl: "https://custom.example",
      language: "zh",
    });

    expect(set).toHaveBeenCalledWith({
      "ankify.settings": {
        language: "zh",
      },
    });
  });
});
