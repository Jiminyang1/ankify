import type {
  BackgroundRequest,
  ContentResponse,
  ContentSettingsResponse,
  SolvedSyncState,
  SubmissionSummary,
} from "../shared/messages";
import { encodeCapturePayload, encodeSubmissionSyncPayload } from "../shared/capture-payload";
import {
  addSentSubmissionIds,
  getSentSubmissionIds,
  getSettings,
  getSolvedSyncState,
  setSolvedSyncState,
} from "../shared/storage";

// Extension settings and drafts are private to trusted extension contexts.
void chrome.storage.local
  .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch((err) => console.error("ankify: failed to restrict local storage", err));

// MV3 service worker. Opens the Side Panel when the toolbar action is clicked.
chrome.runtime.onInstalled.addListener((details) => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("ankify: failed to set panel behavior", err));

  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    void getSettings()
      .then((settings) =>
        chrome.tabs.create({
          url: `${settings.apiBaseUrl.replace(/\/+$/, "")}/welcome?source=extension`,
        }),
      )
      .catch((err) => console.error("ankify: failed to open welcome page", err));
  }
});

// Re-apply on startup in case the install hook missed it (e.g. after browser update).
chrome.runtime.onStartup?.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("ankify: failed to set panel behavior", err));
});

/* ------------------------------------------------------------------------ *
 * Problem pages. Content scripts report (slug, recent submissions); we look
 * the problem up in ankify and then:
 * - badge the tab when it's solved on LeetCode but not in the deck,
 * - auto-capture it when a new Accepted landed (the autoCapture setting),
 * - send captured problems the submissions ankify is missing (append-only,
 *   so it never un-archives or reschedules anything).
 * Missing config, sign-out, and API errors never badge or capture.
 * ------------------------------------------------------------------------ */

const BADGE_TEXT = "!";
const BADGE_BG = "#d4a853"; // ankify gold accent
const CAPTURED_BADGE_MS = 4_000;
const CACHE_TTL_MS = 60_000;
const MAX_SYNC_SUBMISSIONS = 20;

type ProblemState = { captured: false } | { captured: true; ids: Set<string> };

/** slug → ankify state, so SPA hops and the 60s re-check don't re-hit the
 *  API. Lives only as long as the service worker. */
const problemCache = new Map<string, { state: ProblemState; at: number }>();
/** Slugs with a check in flight, so overlapping checks don't double-capture. */
const busy = new Set<string>();

chrome.runtime.onMessage.addListener((msg: BackgroundRequest | { type?: string }, sender, sendResponse) => {
  if (msg?.type === "problem_page_check") {
    const tabId = sender.tab?.id;
    if (tabId != null) void handleProblemPage(tabId, msg as Extract<BackgroundRequest, { type: "problem_page_check" }>);
  } else if (msg?.type === "capture_badge_captured") {
    const { slug } = msg as Extract<BackgroundRequest, { type: "capture_badge_captured" }>;
    problemCache.delete(slug);
    void clearBadgeForSlug(slug);
  } else if (msg?.type === "get_content_settings") {
    void getSettings()
      .then((settings) => {
        sendResponse({
          resetCodeOnProblemOpen: settings.resetCodeOnProblemOpen,
        } satisfies ContentSettingsResponse);
      })
      .catch(() => {
        sendResponse({ resetCodeOnProblemOpen: false } satisfies ContentSettingsResponse);
      });
    return true;
  } else if (msg?.type === "solved_sync_due") {
    void isSolvedSyncDue().then((due) => sendResponse({ due }));
    return true;
  } else if (msg?.type === "solved_sync") {
    const { username, slugs } = msg as Extract<BackgroundRequest, { type: "solved_sync" }>;
    void postSolvedList(username, slugs).then(sendResponse);
    return true;
  }
  return false;
});

async function apiBase(): Promise<string | null> {
  const settings = await getSettings();
  return settings.apiBaseUrl ? settings.apiBaseUrl.replace(/\/+$/, "") : null;
}

/** null when ankify can't answer (not signed in, offline, misconfigured). */
async function loadProblemState(slug: string): Promise<ProblemState | null> {
  const cached = problemCache.get(slug);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.state;

  try {
    const base = await apiBase();
    if (!base) return null;
    const res = await fetch(`${base}/api/problems/by-slug/${encodeURIComponent(slug)}/submissions`, {
      credentials: "include",
    });
    let state: ProblemState;
    if (res.status === 404) {
      state = { captured: false };
    } else if (res.ok) {
      const body = (await res.json()) as { leetcodeSubmissionIds: string[] };
      state = { captured: true, ids: new Set(body.leetcodeSubmissionIds) };
    } else {
      return null;
    }
    problemCache.set(slug, { state, at: Date.now() });
    return state;
  } catch {
    return null;
  }
}

async function handleProblemPage(
  tabId: number,
  { slug, submissions, newAcceptedIds }: Extract<BackgroundRequest, { type: "problem_page_check" }>,
) {
  if (!slug) {
    await setBadge(tabId, false);
    return;
  }
  if (busy.has(slug)) return;
  busy.add(slug);
  try {
    const state = await loadProblemState(slug);
    if (!state) {
      await setBadge(tabId, false);
      return;
    }
    if (!state.captured) {
      const settings = await getSettings();
      if (settings.autoCapture && newAcceptedIds.length > 0 && (await autoCapture(tabId, slug))) {
        await flashCaptured(tabId);
        return;
      }
      await setBadge(tabId, submissions.some((s) => s.status === "Accepted"));
      return;
    }
    await setBadge(tabId, false);
    await syncMissingSubmissions(tabId, slug, submissions, state.ids);
  } catch (err) {
    console.warn("ankify: problem page check failed", err);
  } finally {
    busy.delete(slug);
  }
}

async function askTab(tabId: number, request: Parameters<typeof chrome.tabs.sendMessage>[1]) {
  try {
    return (await chrome.tabs.sendMessage(tabId, request)) as ContentResponse | undefined;
  } catch {
    return undefined; // tab navigated away or closed
  }
}

async function autoCapture(tabId: number, slug: string): Promise<boolean> {
  const resp = await askTab(tabId, { type: "capture_current_problem" });
  if (resp?.type !== "captured" || resp.data.leetcodeSlug !== slug) return false;
  const base = await apiBase();
  if (!base) return false;
  const res = await fetch(`${base}/api/capture`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: encodeCapturePayload(resp.data),
  });
  if (!res.ok) return false;
  problemCache.delete(slug);
  // Everything captured just now counts as sent.
  await addSentSubmissionIds(
    slug,
    resp.data.submissions.map((s) => s.leetcodeSubmissionId).filter((id): id is string => Boolean(id)),
  );
  return true;
}

async function syncMissingSubmissions(
  tabId: number,
  slug: string,
  submissions: SubmissionSummary[],
  storedIds: Set<string>,
) {
  const sent = await getSentSubmissionIds(slug);
  const missing = submissions
    .filter((s) => !storedIds.has(s.id) && !sent.has(s.id))
    .slice(0, MAX_SYNC_SUBMISSIONS);
  if (missing.length === 0) return;

  const resp = await askTab(tabId, { type: "fetch_submissions", submissions: missing });
  if (resp?.type !== "submissions" || resp.data.length === 0) return;
  const base = await apiBase();
  if (!base) return;
  const res = await fetch(`${base}/api/problems/by-slug/${encodeURIComponent(slug)}/submissions`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: encodeSubmissionSyncPayload(resp.data),
  });
  if (!res.ok) return;
  const ids = resp.data.map((s) => s.leetcodeSubmissionId).filter((id): id is string => Boolean(id));
  ids.forEach((id) => storedIds.add(id));
  await addSentSubmissionIds(slug, ids);
}

async function clearBadgeForSlug(slug: string) {
  try {
    const tabs = await chrome.tabs.query({
      url: `https://leetcode.com/problems/${slug}*`,
    });
    await Promise.all(tabs.map((tab) => (tab.id != null ? setBadge(tab.id, false) : Promise.resolve())));
  } catch (err) {
    console.warn("ankify: failed to clear capture badge", err);
  }
}

async function setBadge(tabId: number, show: boolean) {
  try {
    await chrome.action.setBadgeText({ tabId, text: show ? BADGE_TEXT : "" });
    if (show) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_BG });
      await chrome.action.setBadgeTextColor?.({ tabId, color: "#1c1917" });
    }
  } catch {
    /* tab closed between message and update */
  }
}

/** Brief confirmation that an auto-capture happened. */
async function flashCaptured(tabId: number) {
  try {
    await chrome.action.setBadgeText({ tabId, text: "✓" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#2d8f6d" });
    await chrome.action.setBadgeTextColor?.({ tabId, color: "#ffffff" });
    setTimeout(() => void setBadge(tabId, false), CAPTURED_BADGE_MS);
  } catch {
    /* tab closed */
  }
}

/* ------------------------------------------------------------------------ *
 * Solved-list sync. Once a day a LeetCode problem page reads the signed-in
 * user's solved list (slugs only) and we post it to ankify, which also links
 * that LeetCode account. The profile uses it to mark plan problems solved.
 * ------------------------------------------------------------------------ */

const SOLVED_SYNC_EVERY_MS = 20 * 60 * 60 * 1000;
const SOLVED_SYNC_RETRY_MS = 60 * 60 * 1000;

async function isSolvedSyncDue(): Promise<boolean> {
  const last = await getSolvedSyncState();
  if (!last) return true;
  return Date.now() - last.at > (last.ok ? SOLVED_SYNC_EVERY_MS : SOLVED_SYNC_RETRY_MS);
}

async function postSolvedList(username: string, slugs: string[]): Promise<SolvedSyncState> {
  let state: SolvedSyncState;
  try {
    const base = await apiBase();
    if (!base) throw new Error("not_configured");
    const res = await fetch(`${base}/api/leetcode/solved`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, slugs }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(res.status === 401 ? "signed_out" : (body?.error ?? `HTTP ${res.status}`));
    }
    const body = (await res.json()) as { username: string; count: number };
    state = { ok: true, at: Date.now(), username: body.username, count: body.count };
  } catch (err) {
    state = { ok: false, at: Date.now(), error: err instanceof Error ? err.message : String(err) };
  }
  await setSolvedSyncState(state);
  return state;
}
