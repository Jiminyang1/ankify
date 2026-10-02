import type { ReviewOverviewDto } from "@ankify/contracts";
import { classifySender, parseMessage } from "../shared/protocol";
import { getSettings } from "../shared/storage";
import { createAccountState } from "./account";
import { createAnalysisClient } from "./analysis";
import { createApiClient } from "./api";
import { chromeKeyValueStore, createActivityTotals, createTokenRegistry } from "./chrome-adapters";
import { createIdbOutboxStore, openSyncDatabase } from "./idb-store";
import { changesSessionState, SESSION_CHANGED } from "./notify";
import { createOutbox, type DeliveryOutcome, type OutboxOperation } from "./outbox";
import { createRouter } from "./router";
import { createSessionController } from "./sessions";
import { createSuggestionsClient } from "./suggestions";

/**
 * MV3 service worker. It may stop at any time, so everything here is rebuilt
 * cheaply on start; durable state lives in IndexedDB (the outbox) and
 * chrome.storage.session (owner tokens, activity totals).
 */

// Extension settings and drafts are private to trusted extension contexts.
void chrome.storage.local
  .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch((err) => console.error("ankify: failed to restrict local storage", err));
void chrome.storage.session
  .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch((err) => console.error("ankify: failed to restrict session storage", err));

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    void chrome.tabs
      .create({ url: `${__ANKIFY_DEFAULT_API_ORIGIN__}/welcome?source=extension` })
      .catch((err) => console.error("ankify: failed to open welcome page", err));
  }
});

const SYNC_ALARM = "ankify-sync";
const BADGE_ALARM = "ankify-badge";
const BADGE_COLOR = "#d4a853"; // ankify gold accent
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

async function setBadge(overview: ReviewOverviewDto | null) {
  const count = overview ? overview.due.length + overview.pendingRatings.length : 0;
  await chrome.action.setBadgeText({ text: count > 0 ? String(Math.min(count, 99)) : "" });
  if (count > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    await chrome.action.setBadgeTextColor?.({ color: "#1c1917" });
  }
}

/** The account's day boundaries follow this device's time zone (read from
 *  the browser, no permission needed), as on the web app. */
async function followDeviceTimeZone(saved: string) {
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!device || device === saved) return;
  await api.request("/api/settings", { body: { timeZone: device } }).catch(() => undefined);
}

/**
 * Tells the other surfaces to re-read session state: the popup (when open)
 * over the runtime, problem pages over their tabs. The server stays the only
 * source of truth; this is just a nudge, and nobody listening is fine.
 */
async function broadcastSessionChange(options: { popup: boolean; exceptTabId?: number }) {
  if (options.popup) void chrome.runtime.sendMessage(SESSION_CHANGED).catch(() => undefined);
  const tabs = await chrome.tabs.query({ url: "https://leetcode.com/problems/*" }).catch(() => []);
  for (const tab of tabs) {
    if (tab.id != null && tab.id !== options.exceptTabId) void chrome.tabs.sendMessage(tab.id, SESSION_CHANGED).catch(() => undefined);
  }
}

const outbox = createOutbox({ store: createIdbOutboxStore(() => openSyncDatabase()), deliver });
const controller = createSessionController({
  api,
  outbox,
  account,
  tokens,
  totals: createActivityTotals(chrome.storage.session),
  newId,
  // Saved work landed later (timer, reconnect, popup): everyone re-reads.
  onDelivered: () => void broadcastSessionChange({ popup: true }),
});
const router = createRouter({
  analysis: createAnalysisClient({ api, newId }),
  suggestions: createSuggestionsClient({ api, newId }),
  controller,
  account,
  api,
  tokens,
  newId,
  settings: async () => ({ language: (await getSettings()).language }),
  onOverview: (overview) => {
    void setBadge(overview).catch(() => undefined);
    void followDeviceTimeZone(overview.timeZone);
  },
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

async function refreshBadge() {
  const result = await controller.overview().catch(() => null);
  await setBadge(result?.ok ? result.response : null).catch(() => undefined);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) void syncNow();
  if (alarm.name === BADGE_ALARM) void refreshBadge();
});
void chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 30 });
// A closed tab releases the sessions it controlled; the popup and the other
// problem tabs re-read, so they offer Resume at once.
chrome.tabs.onRemoved.addListener((tabId) => {
  void controller
    .releaseTab(tabId)
    .then((released) => {
      if (released > 0) void broadcastSessionChange({ popup: true });
    })
    .catch(() => undefined);
});
void syncNow();
void refreshBadge();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const context = classifySender(sender, chrome.runtime.id);
  if (!context) return false;
  const parsed = parseMessage(message, context);
  if (!parsed) {
    sendResponse({ ok: false, error: "invalid_message" });
    return false;
  }
  router
    .handle(parsed, context)
    .then((response) => {
      sendResponse(response);
      // The sender already has the answer; everyone else re-reads.
      if (changesSessionState(parsed, response)) {
        void broadcastSessionChange({ popup: context.kind !== "page", ...(context.kind === "content" ? { exceptTabId: context.tabId } : {}) });
      }
      void scheduleSync();
    })
    .catch((error: unknown) => {
      console.warn("ankify: message failed", error);
      sendResponse({ ok: false, error: "unexpected" });
    });
  return true;
});
