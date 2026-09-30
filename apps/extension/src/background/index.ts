import type { BackgroundRequest, ContentSettingsResponse } from "../shared/messages";
import { classifySender, parseMessage } from "../shared/protocol";
import { getSettings } from "../shared/storage";
import { createAccountState } from "./account";
import { createApiClient } from "./api";
import { chromeKeyValueStore, createActivityTotals, createTokenRegistry } from "./chrome-adapters";
import { createIdbOutboxStore, openSyncDatabase } from "./idb-store";
import { createOutbox, type DeliveryOutcome, type OutboxOperation } from "./outbox";
import { createRouter } from "./router";
import { createSessionController } from "./sessions";

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

/* ------------------------------------------------------------------------ *
 * Practice sessions: validated messages, the session controller, and the
 * durable outbox. Everything here is rebuilt cheaply when the worker restarts;
 * durable state lives in IndexedDB and chrome.storage.session.
 * ------------------------------------------------------------------------ */

const SYNC_ALARM = "ankify-sync";
const newId = () => crypto.randomUUID();
const api = createApiClient({ origin: __ANKIFY_DEFAULT_API_ORIGIN__ });
const account = createAccountState({ api, store: chromeKeyValueStore(chrome.storage.local) });
const tokens = createTokenRegistry(chrome.storage.session, newId);

async function deliver(operation: OutboxOperation): Promise<DeliveryOutcome> {
  const result = await api.request<{ results?: { index: number; outcome: string }[] }>(operation.path, { body: operation.body });
  if (result.ok) {
    // Observations whose details hit the storage cap stay local, blocked,
    // until the user frees space; everything else was stored.
    if (operation.kind === "observations") {
      const blockedIndexes = new Set((result.data?.results ?? []).filter((item) => item.outcome === "capacity_blocked").map((item) => item.index));
      if (blockedIndexes.size > 0) {
        const observations = (operation.body as { observations: unknown[] }).observations.filter((_, index) => blockedIndexes.has(index));
        return { kind: "blocked", body: { observations }, code: "capacity_blocked" };
      }
    }
    return { kind: "delivered", data: result.data };
  }
  if (result.kind === "auth") return { kind: "auth" };
  if (result.kind === "rejected") return { kind: "rejected", status: result.status, code: result.code ?? null };
  return { kind: "retry", status: result.status, code: result.code, retryAfterMs: result.retryAfterMs };
}

const outbox = createOutbox({ store: createIdbOutboxStore(() => openSyncDatabase()), deliver });
const controller = createSessionController({ api, outbox, account, tokens, totals: createActivityTotals(chrome.storage.session), newId });
const router = createRouter({
  controller,
  account,
  api,
  tokens,
  newId,
  tabs: {
    findProblemTab: async (slug) => {
      const [tab] = await chrome.tabs.query({ url: `https://leetcode.com/problems/${slug}/*` });
      return tab?.id ?? null;
    },
    open: async (slug) => (await chrome.tabs.create({ url: `https://leetcode.com/problems/${slug}/` })).id!,
    focus: async (tabId) => {
      const tab = await chrome.tabs.update(tabId, { active: true });
      if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
    },
  },
});

/** Wakes the worker for the next retry; Chrome enforces a 30 s minimum. */
async function scheduleSync() {
  const status = await controller.syncStatus().catch(() => null);
  if (!status?.nextAttemptAt) {
    await chrome.alarms.clear(SYNC_ALARM);
    return;
  }
  await chrome.alarms.create(SYNC_ALARM, { when: Math.max(status.nextAttemptAt, Date.now() + 30_000) });
}

async function syncNow() {
  await controller.flush().catch((error) => console.warn("ankify: sync failed", error));
  await scheduleSync();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) void syncNow();
});
chrome.tabs.onRemoved.addListener((tabId) => void tokens.forget(tabId));
void syncNow();

chrome.runtime.onMessage.addListener((msg: BackgroundRequest | { type?: string }, sender, sendResponse) => {
  if (msg?.type !== "capture_badge_check" && msg?.type !== "capture_badge_captured" && msg?.type !== "get_content_settings") {
    const context = classifySender(sender, chrome.runtime.id);
    if (!context) return false;
    const parsed = parseMessage(msg, context);
    if (!parsed) {
      sendResponse({ ok: false, error: "invalid_message" });
      return false;
    }
    router
      .handle(parsed, context)
      .then((response) => {
        sendResponse(response);
        void scheduleSync();
      })
      .catch((error: unknown) => {
        console.warn("ankify: message failed", error);
        sendResponse({ ok: false, error: "unexpected" });
      });
    return true;
  }
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
