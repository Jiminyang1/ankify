/** Messages exchanged between content script, popup, and background. */

export type SubmissionStatus =
  | "Accepted"
  | "Wrong Answer"
  | "Time Limit Exceeded"
  | "Memory Limit Exceeded"
  | "Runtime Error"
  | "Compile Error"
  | "Other";

export interface CapturedSubmission {
  leetcodeSubmissionId?: string;
  language: string;
  code: string;
  status: SubmissionStatus;
  runtimeMs?: number;
  memoryKb?: number;
  failedTestcase?: string;
  expectedOutput?: string;
  actualOutput?: string;
  errorMessage?: string;
  submittedAt?: string;
}

export interface CapturedProblem {
  leetcodeSlug: string;
  leetcodeId?: number;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  url: string;
  descriptionMd?: string;
  topicTags: string[];
  similarSlugs: string[];
  submissions: CapturedSubmission[];
}

export type ContentRequest =
  | { type: "capture_current_problem" }
  | { type: "ping" };

export type ContentResponse =
  | { type: "captured"; data: CapturedProblem }
  | { type: "error"; message: string }
  | { type: "pong" };

/** Messages handled by the background service worker (capture badge). */
export type BackgroundRequest =
  /** Content script reports the problem page it's on and whether the user has
   *  an accepted submission there; background badges the tab if uncaptured. */
  | { type: "capture_badge_check"; slug: string | null; hasAccepted: boolean }
  /** Popup reports a successful capture so matching tabs lose their badge. */
  | { type: "capture_badge_captured"; slug: string }
  /** Content scripts receive only the one non-secret preference they need. */
  | { type: "get_content_settings" };

export type ContentSettingsResponse = {
  resetCodeOnProblemOpen: boolean;
};

export interface ExtSettings {
  apiBaseUrl: string;
  language: "en" | "zh";
  resetCodeOnProblemOpen: boolean;
}
