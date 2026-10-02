import type { KeyValueStore } from "./account";
import type { ActivityTotals, TokenRegistry } from "./sessions";

/**
 * Chrome storage backings for the session controller. `storage.session`
 * survives service-worker restarts (not browser restarts) and is readable
 * only by trusted extension contexts, so owner tokens never reach pages.
 */

const TAB_TOKENS = "ankify.tabTokens";
/** Sessions each tab has controlled, released when it closes. */
const TAB_SESSIONS = "ankify.tabSessions";
const MAX_TAB_SESSIONS = 5;
const POPUP_TOKEN = "ankify.popupToken";
const ACTIVITY = "ankify.activity";
const MAX_ACTIVITY_ENTRIES = 200;

/** Serializes read-modify-write cycles on one storage key. */
function serialized() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}

export function createTokenRegistry(
  session: chrome.storage.StorageArea,
  newId: () => string,
): TokenRegistry & { bind(tabId: number, token: string): Promise<void> } {
  const lock = serialized();
  const read = async () => ((await session.get(TAB_TOKENS))[TAB_TOKENS] as Record<string, string> | undefined) ?? {};
  const readSessions = async () => ((await session.get(TAB_SESSIONS))[TAB_SESSIONS] as Record<string, string[]> | undefined) ?? {};
  return {
    tokenFor: (tabId) =>
      lock(async () => {
        const tokens = await read();
        const existing = tokens[String(tabId)];
        if (existing) return existing;
        const token = newId();
        await session.set({ [TAB_TOKENS]: { ...tokens, [String(tabId)]: token } });
        return token;
      }),
    peek: async (tabId) => (await read())[String(tabId)] ?? null,
    popupToken: () =>
      lock(async () => {
        const stored = (await session.get(POPUP_TOKEN))[POPUP_TOKEN] as string | undefined;
        if (stored) return stored;
        const token = newId();
        await session.set({ [POPUP_TOKEN]: token });
        return token;
      }),
    /** Gives a newly opened tab the token its session was started with. */
    bind: (tabId, token) =>
      lock(async () => {
        await session.set({ [TAB_TOKENS]: { ...(await read()), [String(tabId)]: token } });
      }),
    noteSession: (tabId, sessionId) =>
      lock(async () => {
        const all = await readSessions();
        const current = all[String(tabId)] ?? [];
        if (current.includes(sessionId)) return;
        await session.set({ [TAB_SESSIONS]: { ...all, [String(tabId)]: [...current, sessionId].slice(-MAX_TAB_SESSIONS) } });
      }),
    forget: (tabId) =>
      lock(async () => {
        const [tokens, sessions] = await Promise.all([read(), readSessions()]);
        const token = tokens[String(tabId)] ?? null;
        const sessionIds = sessions[String(tabId)] ?? [];
        delete tokens[String(tabId)];
        delete sessions[String(tabId)];
        await session.set({ [TAB_TOKENS]: tokens, [TAB_SESSIONS]: sessions });
        return { token, sessionIds };
      }),
  };
}

export function createActivityTotals(session: chrome.storage.StorageArea): ActivityTotals {
  const lock = serialized();
  return {
    add: (sessionId, token, delta) =>
      lock(async () => {
        const all = ((await session.get(ACTIVITY))[ACTIVITY] as Record<string, { activeMs: number; observedMs: number; at: number }> | undefined) ?? {};
        const key = `${sessionId}:${token}`;
        const current = all[key] ?? { activeMs: 0, observedMs: 0, at: 0 };
        const next = { activeMs: current.activeMs + delta.activeMs, observedMs: current.observedMs + delta.observedMs, at: Date.now() };
        all[key] = next;
        const keys = Object.keys(all);
        if (keys.length > MAX_ACTIVITY_ENTRIES) {
          for (const stale of keys.sort((a, b) => all[a]!.at - all[b]!.at).slice(0, keys.length - MAX_ACTIVITY_ENTRIES)) delete all[stale];
        }
        await session.set({ [ACTIVITY]: all });
        return { activeMs: next.activeMs, observedMs: next.observedMs };
      }),
  };
}

export function chromeKeyValueStore(area: chrome.storage.StorageArea): KeyValueStore {
  return {
    get: async (key) => (await area.get(key))[key],
    set: async (key, value) => {
      await area.set({ [key]: value });
    },
  };
}
