import type { ContentMessage } from "../shared/protocol";
import type { ContentRequest, ContentResponse } from "../shared/messages";
import { captureCurrent } from "./leetcode";
import { createLeetcodeClient } from "./leetcode-client";
import { createPageSession, type PageSession } from "./page-session";
import { startAutoResetCodeOnProblemPages } from "./reset-code";
import { startCaptureBadge } from "./capture-badge";

startAutoResetCodeOnProblemPages();
startCaptureBadge();

chrome.runtime.onMessage.addListener(
  (msg: ContentRequest, _sender, sendResponse: (r: ContentResponse) => void) => {
    if (msg.type === "ping") {
      sendResponse({ type: "pong" });
      return false;
    }
    if (msg.type === "capture_current_problem") {
      captureCurrent()
        .then((data) => sendResponse({ type: "captured", data }))
        .catch((err: unknown) =>
          sendResponse({ type: "error", message: err instanceof Error ? err.message : String(err) }),
        );
      return true; // async
    }
    return false;
  },
);

/* ------------------------------------------------------------------------ *
 * Practice-session tracking for the problem on this page. LeetCode is a
 * single-page app, so the tracked problem follows the URL.
 * ------------------------------------------------------------------------ */

const client = createLeetcodeClient();
let page: PageSession | null = null;
let currentSlug: string | null = null;

async function send<T>(message: ContentMessage) {
  try {
    return (await chrome.runtime.sendMessage(message)) as { ok: true; response: T } | { ok: false; error: "offline" };
  } catch {
    // The worker is restarting or the extension was reloaded; treat as offline.
    return { ok: false as const, error: "offline" as const };
  }
}

function slugFromLocation() {
  return window.location.pathname.match(/^\/problems\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/)?.[1] ?? null;
}

function mount() {
  const slug = slugFromLocation();
  if (slug === currentSlug) return;
  page?.dispose();
  page = null;
  currentSlug = slug;
  if (!slug) return;
  page = createPageSession({
    slug,
    client,
    send,
    now: Date.now,
    isActive: () => document.visibilityState === "visible" && document.hasFocus(),
    schedule: (task, ms) => {
      const timer = window.setTimeout(task, ms);
      return () => window.clearTimeout(timer);
    },
  });
  void page.refresh();
}

const onActivityChange = () => page?.onVisibilityChange();
document.addEventListener("visibilitychange", onActivityChange);
window.addEventListener("focus", onActivityChange);
window.addEventListener("blur", onActivityChange);
window.addEventListener("popstate", mount);
window.setInterval(mount, 1_000);
mount();
