import type { ExtSettings } from "./messages";

export const SETTINGS_KEY = "ankify.settings";

const DEFAULTS: ExtSettings = {
  apiBaseUrl: __ANKIFY_DEFAULT_API_ORIGIN__,
  language: "en",
};

export async function getSettings(): Promise<ExtSettings> {
  const r = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = r[SETTINGS_KEY] as
    | (Partial<ExtSettings> & { apiToken?: string; resetCodeOnProblemOpen?: boolean })
    | undefined;
  const {
    apiToken: retiredToken,
    apiBaseUrl: retiredApiBaseUrl,
    resetCodeOnProblemOpen: retiredAutoReset,
    ...safeSettings
  } = stored ?? {};
  const settings = { ...DEFAULTS, ...safeSettings };

  // Authentication and the API origin are release configuration, not user
  // settings, and the editor is only reset on request now. Remove values
  // written by older releases so an upgrade cannot keep using them.
  if (retiredToken !== undefined || retiredApiBaseUrl !== undefined || retiredAutoReset !== undefined) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: safeSettings });
  }

  return settings;
}

export async function setSettings(s: Partial<ExtSettings>) {
  const current = await getSettings();
  const preferences: Partial<ExtSettings> = { ...current, ...s };
  delete preferences.apiBaseUrl;
  await chrome.storage.local.set({ [SETTINGS_KEY]: preferences });
}
