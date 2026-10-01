import type { BrowserContext, Page } from "@playwright/test";
import type { PracticeSessionCurrentDto, SessionAnalysisStateDto, SuggestionListDto } from "../../packages/contracts/src";
import { API_ORIGIN, test, expect } from "./fixtures";
import { newProblem } from "./helpers";
import type { LeetcodeFixtureState } from "./leetcode-fixture";

// Web surfaces of the extension-first workflow, signed in as the QA user
// (the `panel` fixture signs in through /api/qa/login).
type Settings = { review: { dailyReviewLimit: number; initialReviewDelayHours: number }; analysis: { automatic: boolean; dailyAutomaticLimit: number } };

async function openWeb(context: BrowserContext, path: string, language: "en" | "zh" = "en"): Promise<Page> {
  await context.addCookies([{ name: "ankify-language", value: language, url: API_ORIGIN }]);
  const page = await context.newPage();
  await page.goto(`${API_ORIGIN}${path}`);
  return page;
}

type Api = <T>(path: string, init?: { body?: unknown; method?: string }) => Promise<T>;
let nextSubmissionId = 70_000;

/** A first practice finished through the API: two failures, then Accepted. */
async function finishedSession(api: Api, leetcode: LeetcodeFixtureState, name: string) {
  const slug = newProblem(leetcode, name);
  const title = leetcode.problems[slug]!.title;
  const ownerToken = crypto.randomUUID();
  const started = await api<{ session: { id: string } }>("/api/practice-sessions", {
    body: {
      requestId: crypto.randomUUID(), ownerToken, mode: "practice", baseline: { state: "none" }, supersedePendingRating: false,
      target: { kind: "leetcode", problem: { leetcodeSlug: slug, title, difficulty: "Easy", url: `https://leetcode.com/problems/${slug}/`, topicTags: ["E2E Web"], similarSlugs: [] } },
    },
  });
  const sessionId = started.session.id;
  const now = Date.now();
  await api(`/api/practice-sessions/${sessionId}/submissions`, {
    body: {
      observations: [["Wrong Answer", "return 0"], ["Wrong Answer", "return -1"], ["Accepted", "return 1"]].map(([verdict, code], index) => ({
        leetcodeSubmissionId: String(nextSubmissionId++), verdict, submittedAt: new Date(now + index * 1_000).toISOString(), detail: { language: "python3", code },
      })),
    },
  });
  await api(`/api/practice-sessions/${sessionId}/commands`, { body: { type: "finish", requestId: crypto.randomUUID(), ownerToken, result: "solved", occurredAt: new Date(now + 5_000).toISOString() } });
  return { sessionId, slug, title };
}

test.afterEach(async ({ api, context }) => {
  await api("/api/settings", { body: { analysisAutomatic: false, initialReviewDelayHours: 24, provider: "deepseek", model: "deepseek-chat", apiKey: "" } });
  await context.addCookies([{ name: "ankify-language", value: "en", url: API_ORIGIN }]);
});

test("settings save the first-review delay and, with the user's own key, automatic analysis", async ({ context, api }) => {
  await api("/api/settings", { body: { provider: "deepseek", model: "deepseek-chat", apiKey: "" } });
  const page = await openWeb(context, "/settings");
  const analysis = page.getByRole("region", { name: "Session analysis" });
  await expect(analysis.getByText("Add your own AI provider key above to analyze sessions from the extension.")).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("First review after (hours)").fill("48");
  await page.getByRole("button", { name: "Save review settings" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" }).first()).toBeVisible();
  expect((await api<Settings>("/api/settings")).review.initialReviewDelayHours).toBe(48);

  await api("/api/settings", { body: { provider: "deepseek", model: "deepseek-chat", apiKey: "e2e-own-key" } });
  await page.reload();
  await expect(page.getByLabel("First review after (hours)")).toHaveValue("48");
  await analysis.getByRole("checkbox", { name: /Analyze qualifying sessions automatically/ }).check();
  await analysis.getByLabel("Automatic analyses per day").fill("3");
  await analysis.getByRole("button", { name: "Save analysis settings" }).click();
  await expect.poll(async () => (await api<Settings>("/api/settings")).analysis).toEqual({ automatic: true, dailyAutomaticLimit: 3 });
  await page.close();
});

test("settings and suggestions read in Chinese", async ({ context, panel }) => {
  // The popup fixture signed this context in.
  await expect(panel).toHaveURL(/popup/);
  const page = await openWeb(context, "/settings", "zh");
  await expect(page.getByRole("region", { name: "练习分析" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("首次复习间隔（小时）")).toBeVisible();
  await page.goto(`${API_ORIGIN}/suggestions`);
  await expect(page.getByRole("heading", { level: 1, name: "推荐" })).toBeVisible({ timeout: 30_000 });
  await page.close();
});

test("the suggestions page acts on the same items as the popup", async ({ context, api, leetcode }) => {
  const targets = ["one", "two", "three"].map((name) => newProblem(leetcode, `web-suggest-${name}`));
  const parent = newProblem(leetcode, "web-suggest-parent");
  await api("/api/capture", {
    body: {
      leetcodeSlug: parent, title: "E2E web-suggest-parent", difficulty: "Easy", url: `https://leetcode.com/problems/${parent}/`,
      topicTags: [], similarSlugs: targets,
      similarQuestions: targets.map((slug) => ({ slug, title: leetcode.problems[slug]!.title, difficulty: "Easy", paidOnly: false })),
    },
  });
  const page = await openWeb(context, "/suggestions");
  await expect(page.getByRole("heading", { level: 1, name: "Suggestions" })).toBeVisible({ timeout: 30_000 });
  const pendingBefore = (await api<SuggestionListDto>("/api/suggestions")).suggestions.filter((item) => item.status === "pending").length;
  await page.getByRole("button", { name: "Another suggestion" }).click();
  await expect.poll(async () => (await api<SuggestionListDto>("/api/suggestions")).suggestions.filter((item) => item.status === "pending").length).toBe(pendingBefore + 1);

  const pending = (await api<SuggestionListDto>("/api/suggestions")).suggestions.filter((item) => item.status === "pending");
  const first = pending.at(-1)!;
  const card = page.getByRole("article", { name: first.target.title });
  await expect(card.getByRole("link", { name: "Open on LeetCode" })).toHaveAttribute("href", first.target.url);
  await expect(card.getByText("Not checked against your LeetCode history.")).toBeVisible();

  await card.getByRole("button", { name: "Skip" }).click();
  await expect(card).toHaveCount(0);
  const afterSkip = (await api<SuggestionListDto>("/api/suggestions")).suggestions;
  expect(afterSkip.find((item) => item.id === first.id)?.status).toBe("skipped");
  const replacement = afterSkip.find((item) => item.replacesId === first.id);
  if (replacement) {
    const replacementCard = page.getByRole("article", { name: replacement.target.title });
    await replacementCard.getByRole("button", { name: "Already attempted" }).click();
    await expect(replacementCard).toHaveCount(0);
    expect((await api<SuggestionListDto>("/api/suggestions")).suggestions.find((item) => item.id === replacement.id)?.status).toBe("already_attempted");
  }
  await page.close();
});

test("the mistake profile lists analysis suggestions apart and counts one only once confirmed", async ({ context, api, leetcode }) => {
  // A finished session with three attempts, analyzed with the user's own key
  // (the harness answers from its fake provider).
  await api("/api/settings", { body: { provider: "deepseek", model: "deepseek-chat", apiKey: "e2e-own-key" } });
  const { sessionId, title } = await finishedSession(api, leetcode, "web-profile");
  await api("/api/ai-jobs", { body: { action: "session_analyze", practiceSessionId: sessionId, requestId: crypto.randomUUID() } });
  await expect.poll(async () => (await api<SessionAnalysisStateDto>(`/api/practice-sessions/${sessionId}/analysis`)).job?.status, { timeout: 30_000 }).toBe("succeeded");

  const page = await openWeb(context, "/analysis");
  const profile = page.getByRole("region", { name: "Mistake profile" });
  await expect(profile).toBeVisible({ timeout: 30_000 });
  const candidates = profile.getByRole("region", { name: "Suggested by session analysis" });
  const recorded = profile.getByRole("region", { name: "Recorded mistakes" });
  const suggestion = candidates.getByRole("listitem").filter({ hasText: title }).filter({ hasText: "Edge cases" });
  await expect(suggestion).toHaveCount(1);
  await expect(recorded.getByRole("link", { name: title })).toHaveCount(0);
  await suggestion.getByRole("button", { name: "Confirm" }).click();
  await expect(suggestion).toHaveCount(0);
  await expect(recorded.getByRole("listitem").filter({ hasText: "Edge cases" }).getByRole("link", { name: title })).toHaveCount(1);
  await page.close();
});

test("the mistake profile reads in Chinese", async ({ context, panel }) => {
  await expect(panel).toHaveURL(/popup/);
  const page = await openWeb(context, "/analysis", "zh");
  await expect(page.getByRole("region", { name: "错误画像" })).toBeVisible({ timeout: 30_000 });
  await page.close();
});

test("the dashboard shows today's counts, recent practice, and focus areas", async ({ context, api, leetcode }) => {
  const { title } = await finishedSession(api, leetcode, "web-dashboard");
  const page = await openWeb(context, "/today");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Reviews happen on LeetCode: open a problem and the extension tracks the session.")).toBeVisible();
  const recent = page.getByRole("region", { name: "Recent practice" });
  await expect(recent.getByRole("listitem").filter({ has: page.getByRole("link", { name: title }) }).getByText("Accepted")).toBeVisible();
  await expect(recent.getByText(/^Last 7 days: \d+ sessions? completed/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Focus areas" }).getByRole("link", { name: "View mistake profile" })).toHaveAttribute("href", "/analysis");

  await context.addCookies([{ name: "ankify-language", value: "zh", url: API_ORIGIN }]);
  await page.reload();
  await expect(page.getByRole("region", { name: "最近练习" })).toBeVisible({ timeout: 30_000 });
  await page.close();
});

test("a problem's page lists its sessions and scheduling timeline, and records what a session handled well", async ({ context, api, leetcode }) => {
  const { slug, title } = await finishedSession(api, leetcode, "web-history");
  const { problem } = await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${slug}`);
  const page = await openWeb(context, `/problems/${problem!.id}`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("tab", { name: /Sessions/ }).click();
  const sessions = page.getByRole("tabpanel");
  await expect(sessions.getByText("First practice")).toBeVisible();
  await expect(sessions.getByText("3 submissions, 1 accepted", { exact: false })).toBeVisible();
  await sessions.getByRole("button", { name: "Confirm" }).click();
  await expect(sessions.getByText("Handled well:")).toBeVisible();
  await expect(sessions.getByText("Approach")).toBeVisible();

  await page.getByRole("tab", { name: /History/ }).click();
  const history = page.getByRole("tabpanel");
  await expect(history.getByText("First review scheduled")).toBeVisible();
  await expect(history.getByText(/^Next review /)).toBeVisible();
  await page.close();
});
