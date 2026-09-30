import type { ExtSettings, SolvedSyncState } from "./messages";

export const SETTINGS_KEY = "ankify.settings";
/** Map LeetCode slug → unsent draft text for "+ my card" (survives popup close). */
const CARD_DRAFTS_KEY = "ankify.cardDrafts";

const DEFAULTS: ExtSettings = {
  apiBaseUrl: __ANKIFY_DEFAULT_API_ORIGIN__,
  language: "en",
  resetCodeOnProblemOpen: false,
  autoCapture: true,
};

const MAX_DRAFT_KEYS = 48;

export async function getSettings(): Promise<ExtSettings> {
  const r = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = r[SETTINGS_KEY] as
    | (Partial<ExtSettings> & { apiToken?: string })
    | undefined;
  const {
    apiToken: retiredToken,
    apiBaseUrl: retiredApiBaseUrl,
    ...safeSettings
  } = stored ?? {};
  const settings = { ...DEFAULTS, ...safeSettings };

  // Authentication and the API origin are release configuration, not user
  // settings. Remove values written by older releases so an upgrade cannot
  // keep using a stale token or a custom server.
  if (retiredToken !== undefined || retiredApiBaseUrl !== undefined) {
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

export async function getCardDraft(slug: string): Promise<string> {
  const r = await chrome.storage.local.get(CARD_DRAFTS_KEY);
  const map = (r[CARD_DRAFTS_KEY] as Record<string, string> | undefined) ?? {};
  return map[slug] ?? "";
}

/** Persist draft until user saves to server or clears the box. Debounced callers OK. */
export async function setCardDraft(slug: string, text: string): Promise<void> {
  const r = await chrome.storage.local.get(CARD_DRAFTS_KEY);
  const map = { ...((r[CARD_DRAFTS_KEY] as Record<string, string> | undefined) ?? {}) };
  if (text.trim() === "") {
    delete map[slug];
  } else {
    map[slug] = text.slice(0, 6000);
  }
  const keys = Object.keys(map);
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

const SOLVED_SYNC_KEY = "ankify.solvedSync";
/** Session-scoped, per slug: submission ids already sent to ankify. The
 *  server skips exact duplicates without storing their id, so without this
 *  the same submission would be re-sent on every check. */
const SENT_SUBMISSIONS_KEY = "ankify.sentSubmissions";
const MAX_SENT_SLUGS = 64;

export async function getSolvedSyncState(): Promise<SolvedSyncState | null> {
  const r = await chrome.storage.local.get(SOLVED_SYNC_KEY);
  return (r[SOLVED_SYNC_KEY] as SolvedSyncState | undefined) ?? null;
}

export async function setSolvedSyncState(state: SolvedSyncState): Promise<void> {
  await chrome.storage.local.set({ [SOLVED_SYNC_KEY]: state });
}

export async function getSentSubmissionIds(slug: string): Promise<Set<string>> {
  const r = await chrome.storage.session.get(SENT_SUBMISSIONS_KEY);
  const map = (r[SENT_SUBMISSIONS_KEY] as Record<string, string[]> | undefined) ?? {};
  return new Set(map[slug] ?? []);
}

export async function addSentSubmissionIds(slug: string, ids: string[]): Promise<void> {
  const r = await chrome.storage.session.get(SENT_SUBMISSIONS_KEY);
  const map = { ...((r[SENT_SUBMISSIONS_KEY] as Record<string, string[]> | undefined) ?? {}) };
  map[slug] = [...new Set([...(map[slug] ?? []), ...ids])].slice(-200);
  const slugs = Object.keys(map);
  for (const stale of slugs.slice(0, Math.max(0, slugs.length - MAX_SENT_SLUGS))) delete map[stale];
  await chrome.storage.session.set({ [SENT_SUBMISSIONS_KEY]: map });
}
