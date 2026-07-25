import type { BackgroundRequest } from "../shared/messages";
import { hasRecentAcceptedSubmission } from "./leetcode";

/**
 * Capture badge: detect "solved but never captured" so a forgotten capture
 * doesn't silently leave a hole in the review deck.
 *
 * The content script watches the SPA URL, asks LeetCode's GraphQL whether the
 * current problem has an accepted submission, and reports to the background
 * worker — which checks the ankify API and badges the toolbar icon when the
 * problem isn't in the deck yet.
 */

const NAV_SETTLE_MS = 1_500;
/** Also re-check in place, so solving the open problem badges within a minute. */
const RECHECK_INTERVAL_MS = 60_000;

let started = false;
let scheduled: number | undefined;
let lastSeenUrl = "";
let checkSeq = 0;

export function startCaptureBadge(): void {
  if (started) return;
  started = true;
  lastSeenUrl = window.location.href;
  schedule(NAV_SETTLE_MS);

  window.setInterval(() => {
    if (window.location.href === lastSeenUrl) return;
    lastSeenUrl = window.location.href;
    schedule(NAV_SETTLE_MS);
  }, 1_000);
  window.setInterval(() => schedule(0), RECHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) schedule(250);
  });
}

function schedule(delayMs: number) {
  if (scheduled != null) window.clearTimeout(scheduled);
  scheduled = window.setTimeout(() => {
    scheduled = undefined;
    void check();
  }, delayMs);
}

async function check() {
  if (document.hidden) return;
  const seq = ++checkSeq;
  const slug = slugFromUrl();
  let hasAccepted = false;
  if (slug) {
    try {
      hasAccepted = await hasRecentAcceptedSubmission(slug);
    } catch {
      hasAccepted = false;
    }
  }
  if (seq !== checkSeq) return; // superseded by a newer navigation
  send({ type: "capture_badge_check", slug, hasAccepted });
}

function slugFromUrl(): string | null {
  const m = window.location.pathname.match(/^\/problems\/([^/]+)/);
  return m?.[1] ?? null;
}

function send(msg: BackgroundRequest) {
  try {
    void chrome.runtime.sendMessage(msg).catch(() => {
      /* background asleep or extension reloaded — next check retries */
    });
  } catch {
    /* extension context invalidated (dev reload) */
  }
}
