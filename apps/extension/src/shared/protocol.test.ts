import { describe, expect, it } from "vitest";
import { classifySender, parseMessage } from "./protocol";

const ID = "abcdefghijklmnopabcdefghijklmnop";
const content = (url: string, frameId = 0) => ({ id: ID, url, frameId, tab: { id: 7 } });

describe("message senders", () => {
  it("accepts content scripts only in the top frame of a LeetCode problem page", () => {
    expect(classifySender(content("https://leetcode.com/problems/two-sum/description/"), ID)).toEqual({ kind: "content", tabId: 7, slug: "two-sum" });
    expect(classifySender(content("https://leetcode.com/problems/two-sum"), ID)).toEqual({ kind: "content", tabId: 7, slug: "two-sum" });
    expect(classifySender(content("https://leetcode.com/problems/two-sum/", 3), ID)).toBeNull();
    expect(classifySender(content("https://leetcode.com/problemset/"), ID)).toBeNull();
    expect(classifySender(content("https://leetcode.cn/problems/two-sum/"), ID)).toBeNull();
    expect(classifySender(content("https://evil.example/problems/two-sum/"), ID)).toBeNull();
    expect(classifySender(content("https://leetcode.com/problems/Two_Sum/"), ID)).toBeNull();
    expect(classifySender({ ...content("https://leetcode.com/problems/two-sum/"), tab: {} }, ID)).toBeNull();
  });

  it("accepts extension pages only from this extension and rejects other senders", () => {
    expect(classifySender({ id: ID, url: `chrome-extension://${ID}/src/popup/index.html` }, ID)).toEqual({ kind: "page" });
    // The same page opened in a tab carries a tab but is still an extension page.
    expect(classifySender({ id: ID, url: `chrome-extension://${ID}/src/popup/index.html`, frameId: 0, tab: { id: 3 } }, ID)).toEqual({ kind: "page" });
    expect(classifySender({ id: ID, url: "chrome-extension://otherextensionidotherextensionid/x.html" }, ID)).toBeNull();
    expect(classifySender({ id: "someone-else", url: `chrome-extension://${ID}/src/popup/index.html` }, ID)).toBeNull();
    expect(classifySender({ id: ID, url: "https://leetcode.com/problems/two-sum/" }, ID)).toBeNull();
    expect(classifySender({ id: ID }, ID)).toBeNull();
  });
});

describe("message payloads", () => {
  const page = { kind: "content" as const, tabId: 7, slug: "two-sum" };
  const problem = { leetcodeSlug: "two-sum", leetcodeId: 1, title: "Two Sum", difficulty: "Easy", url: "https://leetcode.com/problems/two-sum/" };

  it("lets a page speak only about its own problem", () => {
    expect(parseMessage({ type: "page_state", slug: "two-sum" }, page)).toMatchObject({ channel: "content" });
    expect(parseMessage({ type: "page_state", slug: "3sum" }, page)).toBeNull();
    expect(parseMessage({ type: "session_start", slug: "two-sum", mode: "practice", problem }, page)).toMatchObject({ message: { supersedePendingRating: false } });
    expect(parseMessage({ type: "session_start", slug: "two-sum", mode: "practice", problem: { ...problem, leetcodeSlug: "3sum" } }, page)).toBeNull();
  });

  it("rejects malformed, oversized, or page-only messages from content scripts", () => {
    expect(parseMessage({ type: "session_activity", sessionId: "s1", activeMs: 5_000, observedMs: 5_000, availability: "available" }, page)).not.toBeNull();
    expect(parseMessage({ type: "session_activity", sessionId: "s1", activeMs: 3_600_000, observedMs: 5_000, availability: "available" }, page)).toBeNull();
    expect(parseMessage({ type: "session_observations", sessionId: "s1", observations: Array(21).fill({ leetcodeSubmissionId: "1", verdict: "Accepted" }) }, page)).toBeNull();
    expect(parseMessage({ type: "session_control", sessionId: "s1", control: { command: "finish", result: "solved" } }, page)).toBeNull();
    expect(parseMessage({ type: "overview" }, page)).toBeNull();
    expect(parseMessage({ type: "session_control", sessionId: "s1", control: { command: "abandon", occurredAt: "2026-09-29T12:00:00.000Z" }, ownerToken: "x" }, page)).toBeNull();
    expect(parseMessage("not an object", page)).toBeNull();
  });

  it("accepts popup messages only on the page channel", () => {
    expect(parseMessage({ type: "overview" }, { kind: "page" })).toEqual({ channel: "page", message: { type: "overview" } });
    expect(parseMessage({ type: "open_review", problemId: "p1", slug: "two-sum" }, { kind: "page" })).not.toBeNull();
    expect(parseMessage({ type: "session_rating", sessionId: "s1", rating: 5 }, { kind: "page" })).toBeNull();
    expect(parseMessage({ type: "page_state", slug: "two-sum" }, { kind: "page" })).toBeNull();
  });
});
