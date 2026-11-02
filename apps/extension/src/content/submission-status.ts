import type { CaptureSubmissionInput } from "@ankify/contracts";

/**
 * LeetCode's verdicts, as one set of English words. leetcode.com sends them in
 * `statusDisplay`. leetcode.cn may send its Chinese labels there, and its
 * submission list also has a `status` code and an `isPending` flag.
 */

const CHINESE_VERDICTS: Record<string, string> = {
  通过: "Accepted",
  解答错误: "Wrong Answer",
  超出内存限制: "Memory Limit Exceeded",
  超出输出限制: "Output Limit Exceeded",
  超出时间限制: "Time Limit Exceeded",
  执行出错: "Runtime Error",
  内部出错: "Internal Error",
  编译出错: "Compile Error",
  超时: "Timeout",
  违反限制: "Restrictions Failed",
};

/** leetcode.cn's status enum, by name and by number. */
const STATUS_CODES: Record<string, string> = {
  AC: "Accepted",
  WA: "Wrong Answer",
  MLE: "Memory Limit Exceeded",
  OLE: "Output Limit Exceeded",
  TLE: "Time Limit Exceeded",
  RE: "Runtime Error",
  IE: "Internal Error",
  CE: "Compile Error",
  TO: "Timeout",
  RESTRICTIONS_FAILED: "Restrictions Failed",
  "10": "Accepted",
  "11": "Wrong Answer",
  "12": "Memory Limit Exceeded",
  "13": "Output Limit Exceeded",
  "14": "Time Limit Exceeded",
  "15": "Runtime Error",
  "16": "Internal Error",
  "20": "Compile Error",
  "30": "Timeout",
  "50": "Restrictions Failed",
};

export type SubmissionRow = {
  statusDisplay?: string | null;
  status?: string | number | null;
  isPending?: string | boolean | null;
};

export function submissionVerdict({ statusDisplay, status, isPending }: SubmissionRow): string {
  if (isPending === true || (typeof isPending === "string" && /^pending$/i.test(isPending))) return "Pending";
  const code = status == null ? undefined : STATUS_CODES[String(status)];
  if (statusDisplay) return CHINESE_VERDICTS[statusDisplay] ?? code ?? statusDisplay;
  return code ?? "Pending";
}

const STORED_VERDICTS: readonly CaptureSubmissionInput["status"][] = [
  "Accepted",
  "Wrong Answer",
  "Time Limit Exceeded",
  "Memory Limit Exceeded",
  "Runtime Error",
  "Compile Error",
];

/** The verdicts ankify stores; anything else is "Other". */
export function storedVerdict(verdict: string): CaptureSubmissionInput["status"] {
  return STORED_VERDICTS.find((known) => known === verdict) ?? "Other";
}
