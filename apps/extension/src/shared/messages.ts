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

export interface ExtSettings {
  apiBaseUrl: string;
  apiToken: string;
}
