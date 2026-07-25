import type { BackgroundRequest, ContentSettingsResponse } from "../shared/messages";
import { getSettings } from "../shared/storage";

// Extension settings and drafts are private to trusted extension contexts.
void chrome.storage.local
  .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch((err) => console.error("ankify: failed to restrict local storage", err));

// MV3 service worker. Opens the Side Panel when the toolbar action is clicked.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("ankify: failed to set panel behavior", err));
});

// Re-apply on startup in case the install hook missed it (e.g. after browser update).
chrome.runtime.onStartup?.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("ankify: failed to set panel behavior", err));
});

/* ------------------------------------------------------------------------ *
 * Capture badge: mark tabs whose problem is solved on LeetCode but missing
 * from the ankify deck. Content scripts report (slug, hasAccepted); we check
 * /api/problems/by-slug and badge the toolbar icon per tab.
 * ------------------------------------------------------------------------ */

const BADGE_TEXT = "!";
const BADGE_BG = "#d4a853"; // ankify gold accent
const CACHE_TTL_MS = 60_000;

/** slug → capture verdict, so SPA hops between the same problems don't
 *  re-hit the API. Lives only as long as the service worker. */
const captureCache = new Map<string, { captured: boolean; at: number }>();

chrome.runtime.onMessage.addListener((msg: BackgroundRequest | { type?: string }, sender, sendResponse) => {
  if (msg?.type === "capture_badge_check") {
    const { slug, hasAccepted } = msg as Extract<BackgroundRequest, { type: "capture_badge_check" }>;
    const tabId = sender.tab?.id;
    if (tabId != null) void updateBadge(tabId, slug, hasAccepted);
  } else if (msg?.type === "capture_badge_captured") {
    const { slug } = msg as Extract<BackgroundRequest, { type: "capture_badge_captured" }>;
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
  }
  return false;
});

async function updateBadge(tabId: number, slug: string | null, hasAccepted: boolean) {
  if (!slug || !hasAccepted) {
    await setBadge(tabId, false);
    return;
  }
  const captured = await isCaptured(slug);
  await setBadge(tabId, !captured);
}

/** Errors and missing config report "captured" so the badge never nags when
 *  the API is unreachable or the extension isn't connected yet. */
async function isCaptured(slug: string): Promise<boolean> {
  const cached = captureCache.get(slug);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.captured;

  try {
    const settings = await getSettings();
    if (!settings.apiBaseUrl) return true;
    const base = settings.apiBaseUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}/api/problems/by-slug/${encodeURIComponent(slug)}`, {
      credentials: "include",
    });
    if (res.status === 404) {
      captureCache.set(slug, { captured: false, at: Date.now() });
      return false;
    }
    if (res.ok) {
      captureCache.set(slug, { captured: true, at: Date.now() });
      return true;
    }
    return true;
  } catch {
    return true;
  }
}

async function clearBadgeForSlug(slug: string) {
  captureCache.set(slug, { captured: true, at: Date.now() });
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
