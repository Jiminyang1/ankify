/** Messages exchanged between content script, popup, and background. */

import type { CaptureProblemInput, CaptureSubmissionInput } from "@ankify/contracts";

/** One row of LeetCode's submission list for the open problem. */
export type SubmissionSummary = { id: string; status: string; timestamp: number };

export type ContentRequest =
  | { type: "capture_current_problem" }
  /** Background asks for full details of submissions ankify is missing. */
  | { type: "fetch_submissions"; submissions: SubmissionSummary[] }
  /** Popup's "Sync now": read the solved list and hand it to the background. */
  | { type: "sync_solved_now" }
  | { type: "ping" };

export type ContentResponse =
  | { type: "captured"; data: CaptureProblemInput }
  | { type: "submissions"; data: CaptureSubmissionInput[] }
  | { type: "solved_synced"; result: SolvedSyncState }
  | { type: "error"; message: string }
  | { type: "pong" };

/** Messages handled by the background service worker. */
export type BackgroundRequest =
  /** Content script reports the problem page it's on and its recent
   *  submissions. Background badges uncaptured solves, auto-captures new
   *  Accepted problems, and syncs submissions ankify is missing. */
  | {
      type: "problem_page_check";
      slug: string | null;
      submissions: SubmissionSummary[];
      /** Accepted submissions made while this page was open (or just before). */
      newAcceptedIds: string[];
    }
  /** Popup reports a successful capture so matching tabs lose their badge. */
  | { type: "capture_badge_captured"; slug: string }
  /** Content scripts receive only the one non-secret preference they need. */
  | { type: "get_content_settings" }
  /** Content script asks whether the daily solved-list sync is due. */
  | { type: "solved_sync_due" }
  /** Content script hands over the signed-in user's solved list. */
  | { type: "solved_sync"; username: string; slugs: string[] };

export type ContentSettingsResponse = {
  resetCodeOnProblemOpen: boolean;
};

/** Last solved-list sync, kept in extension storage for the popup. */
export type SolvedSyncState =
  | { ok: true; at: number; username: string; count: number }
  | { ok: false; at: number; error: string };

export interface ExtSettings {
  apiBaseUrl: string;
  language: "en" | "zh";
  resetCodeOnProblemOpen: boolean;
  /** Capture a problem automatically when a new Accepted lands on it. */
  autoCapture: boolean;
}
