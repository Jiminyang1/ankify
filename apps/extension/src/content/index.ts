import type { ContentRequest, ContentResponse } from "../shared/messages";
import { captureCurrent, fetchSubmissionInputs } from "./leetcode";
import { startAutoResetCodeOnProblemPages } from "./reset-code";
import { startProblemWatch, syncSolved } from "./problem-watch";

startAutoResetCodeOnProblemPages();
startProblemWatch();

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

chrome.runtime.onMessage.addListener(
  (msg: ContentRequest, _sender, sendResponse: (r: ContentResponse) => void) => {
    if (msg.type === "ping") {
      sendResponse({ type: "pong" });
      return false;
    }
    if (msg.type === "capture_current_problem") {
      captureCurrent()
        .then((data) => sendResponse({ type: "captured", data }))
        .catch((err: unknown) => sendResponse({ type: "error", message: errorMessage(err) }));
      return true; // async
    }
    if (msg.type === "fetch_submissions") {
      fetchSubmissionInputs(msg.submissions)
        .then((data) => sendResponse({ type: "submissions", data }))
        .catch((err: unknown) => sendResponse({ type: "error", message: errorMessage(err) }));
      return true;
    }
    if (msg.type === "sync_solved_now") {
      syncSolved()
        .then((result) =>
          sendResponse(result ? { type: "solved_synced", result } : { type: "error", message: "leetcode_signed_out" }),
        )
        .catch((err: unknown) => sendResponse({ type: "error", message: errorMessage(err) }));
      return true;
    }
    return false;
  },
);
