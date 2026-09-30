import type { BackgroundRequest, SolvedSyncState, SubmissionSummary } from "../shared/messages";
import { fetchSolvedList, fetchSubmissionSummaries } from "./leetcode";

/**
 * Problem-page watcher. Each check reports the open problem's recent
 * submissions to the background worker, which badges solved-but-uncaptured
 * problems, auto-captures new Accepted ones, and syncs submissions ankify is
 * missing. It also kicks off the daily solved-list sync.
 */

const NAV_SETTLE_MS = 1_500;
/** Also re-check in place, so a new submission syncs within a minute. */
const RECHECK_INTERVAL_MS = 60_000;
/** Faster checks right after Submit; the 60s re-check covers a missed click. */
const AFTER_SUBMIT_DELAYS_MS = [5_000, 12_000, 25_000, 45_000];
/** An Accepted this recent at the first check counts as new: the page may
 *  have been opened or reloaded right after submitting. */
const RECENT_ACCEPT_WINDOW_S = 10 * 60;

let started = false;
let scheduled: number | undefined;
let lastSeenUrl = "";
let checkSeq = 0;
let submitTimers: number[] = [];
/** Submission ids already on each problem when this page first saw it, so an
 *  old Accepted doesn't auto-capture a problem the user merely opened. */
const baseline = new Map<string, Set<string>>();

export function startProblemWatch(): void {
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
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      if (target?.closest?.('[data-e2e-locator="console-submit-button"]')) burstAfterSubmit();
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) burstAfterSubmit();
    },
    true,
  );

  void syncSolvedIfDue();
}

function schedule(delayMs: number) {
  if (scheduled != null) window.clearTimeout(scheduled);
  scheduled = window.setTimeout(() => {
    scheduled = undefined;
    void check();
  }, delayMs);
}

function burstAfterSubmit() {
  submitTimers.forEach((timer) => window.clearTimeout(timer));
  submitTimers = AFTER_SUBMIT_DELAYS_MS.map((ms) => window.setTimeout(() => void check(), ms));
}

async function check() {
  if (document.hidden) return;
  const seq = ++checkSeq;
  const slug = slugFromUrl();
  let submissions: SubmissionSummary[] = [];
  let loaded = false;
  if (slug) {
    try {
      submissions = await fetchSubmissionSummaries(slug);
      loaded = true;
    } catch {
      submissions = [];
    }
  }
  if (seq !== checkSeq) return; // superseded by a newer navigation
  const newAcceptedIds = slug && loaded ? newAccepted(slug, submissions) : [];
  send({ type: "problem_page_check", slug, submissions, newAcceptedIds });
}

function newAccepted(slug: string, submissions: SubmissionSummary[]): string[] {
  let known = baseline.get(slug);
  const firstLook = !known;
  if (!known) {
    known = new Set(submissions.map((s) => s.id));
    baseline.set(slug, known);
  }
  const nowS = Date.now() / 1000;
  return submissions
    .filter(
      (s) =>
        s.status === "Accepted" &&
        ((!firstLook && !known.has(s.id)) || nowS - s.timestamp < RECENT_ACCEPT_WINDOW_S),
    )
    .map((s) => s.id);
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

async function ask<T>(msg: BackgroundRequest): Promise<T | undefined> {
  try {
    return (await chrome.runtime.sendMessage(msg)) as T;
  } catch {
    return undefined;
  }
}

async function syncSolvedIfDue() {
  const due = await ask<{ due: boolean }>({ type: "solved_sync_due" });
  if (!due?.due) return;
  try {
    await syncSolved();
  } catch (err) {
    console.warn("[ankify] solved-list sync failed", err);
  }
}

/** Read the signed-in user's solved list and hand it to the background.
 *  null when nobody is signed in to LeetCode. */
export async function syncSolved(): Promise<SolvedSyncState | null> {
  const list = await fetchSolvedList();
  if (!list) return null;
  return (await ask<SolvedSyncState>({ type: "solved_sync", username: list.username, slugs: list.slugs })) ?? null;
}
