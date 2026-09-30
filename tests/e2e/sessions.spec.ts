import type { CaptureProblemInput, PracticeSessionCurrentDto } from "../../packages/contracts/src";
import { test, expect, API_ORIGIN } from "./fixtures";
import { fixtureSlug, fixtureUrl, installLeetcodeFixture } from "./leetcode-fixture";

test("a review opened from the extension tracks new submissions from the problem page", async ({ context, panel }) => {
  const leetcode = await installLeetcodeFixture(context);
  const api = <T,>(path: string, body?: unknown) => panel.evaluate(async ({ origin, path, body }) => {
    const response = await fetch(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return (await response.json()) as T;
  }, { origin: API_ORIGIN, path, body });

  // A captured problem is enrolled and due now.
  const captured = await api<{ problemId: string }>("/api/capture", {
    leetcodeSlug: fixtureSlug, leetcodeId: 20, title: "Valid Parentheses", difficulty: "Easy", url: fixtureUrl,
  } satisfies Partial<CaptureProblemInput>);

  const opened = await panel.evaluate(({ problemId, slug }) => chrome.runtime.sendMessage({ type: "open_review", problemId, slug }), {
    problemId: captured.problemId,
    slug: fixtureSlug,
  }) as { ok: boolean; response: { created: boolean; session: { id: string; type: string; capture: { baselineState: string } } } };
  expect(opened).toMatchObject({ ok: true, response: { created: true, session: { type: "scheduled_review", capture: { baselineState: "pending" } } } });

  // The opened tab owns the session and sets the baseline to the newest submission.
  const current = () => api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${fixtureSlug}`);
  await expect.poll(async () => (await current()).session?.capture.baselineSubmissionId, { timeout: 20_000 }).toBe("9003");
  const tab = context.pages().find((page) => page.url().startsWith(fixtureUrl));
  expect(tab).toBeDefined();

  // The user submits on LeetCode; the page reports it when it regains focus.
  leetcode.submissions.push({ id: "9004", statusDisplay: "Accepted", timestamp: Math.floor(Date.now() / 1000), code: "return True" });
  await tab!.bringToFront();
  await tab!.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(async () => (await current()).session?.evidence, { timeout: 20_000 }).toMatchObject({ submissions: 1, accepted: 1 });
  expect((await current()).session).toMatchObject({ status: "active", ownership: "other_tab" });
});
