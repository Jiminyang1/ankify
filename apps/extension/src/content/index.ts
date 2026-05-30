import type { ContentRequest, ContentResponse } from "../shared/messages";
import { captureCurrent } from "./leetcode";
import { startAutoResetCodeOnProblemPages } from "./reset-code";

startAutoResetCodeOnProblemPages();

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
