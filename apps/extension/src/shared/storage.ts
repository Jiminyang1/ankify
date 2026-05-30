import type { ExtSettings } from "./messages";

const KEY = "ankify.settings";
/** Map LeetCode slug → unsent draft text for "+ my card" (survives popup close). */
const CARD_DRAFTS_KEY = "ankify.cardDrafts";

const DEFAULTS: ExtSettings = {
  apiBaseUrl: "http://localhost:3000",
  apiToken: "",
  language: "en",
};

const MAX_DRAFT_KEYS = 48;

export async function getSettings(): Promise<ExtSettings> {
  const r = await chrome.storage.local.get(KEY);
  return { ...DEFAULTS, ...(r[KEY] as Partial<ExtSettings> | undefined) };
}

export async function setSettings(s: Partial<ExtSettings>) {
  const current = await getSettings();
  await chrome.storage.local.set({ [KEY]: { ...current, ...s } });
}

export async function getCardDraft(slug: string): Promise<string> {
  const r = await chrome.storage.local.get(CARD_DRAFTS_KEY);
  const map = (r[CARD_DRAFTS_KEY] as Record<string, string> | undefined) ?? {};
  return map[slug] ?? "";
}

/** Persist draft until user saves to server or clears the box. Debounced callers OK. */
export async function setCardDraft(slug: string, text: string): Promise<void> {
  const r = await chrome.storage.local.get(CARD_DRAFTS_KEY);
  let map = { ...((r[CARD_DRAFTS_KEY] as Record<string, string> | undefined) ?? {}) };
  if (text.trim() === "") {
    delete map[slug];
  } else {
    map[slug] = text.slice(0, 6000);
  }
  let keys = Object.keys(map);
  if (keys.length > MAX_DRAFT_KEYS) {
    keys.sort();
    const drop = keys.slice(0, keys.length - MAX_DRAFT_KEYS);
    for (const k of drop) delete map[k];
  }
  await chrome.storage.local.set({ [CARD_DRAFTS_KEY]: map });
}

export async function clearCardDraft(slug: string): Promise<void> {
  await setCardDraft(slug, "");
}
