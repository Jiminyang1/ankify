import type { BrowserContext, Page } from "@playwright/test";
import type { PracticeSessionCurrentDto, SessionAnalysisStateDto, SuggestionListDto } from "../../packages/contracts/src";
import { API_ORIGIN, test, expect } from "./fixtures";
import { newProblem } from "./helpers";
import type { LeetcodeFixtureState } from "./leetcode-fixture";

// Web surfaces of the extension-first workflow, signed in as the QA user
// (the `panel` fixture signs in through /api/qa/login).
type Settings = { review: { dailyReviewLimit: number; initialReviewDelayHours: number }; analysis: { automatic: boolean } };

async function openWeb(context: BrowserContext, path: string, language: "en" | "zh" = "en"): Promise<Page> {
  await context.addCookies([{ name: "ankify-language", value: language, url: API_ORIGIN }]);
  const page = await context.newPage();
  await page.goto(`${API_ORIGIN}${path}`);
  return page;
}

type Api = <T>(path: string, init?: { body?: unknown; method?: string }) => Promise<T>;
// Time-based (a worker reload must not reuse ids), in a range apart from the
// LeetCode fixture's.
let nextSubmissionId = Date.now() * 10;

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
  await expect(analysis.getByText("Add your own AI provider key above. Every finished session, first practice or review, is then analyzed automatically.")).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("First review after (hours)").fill("48");
  await page.getByRole("button", { name: "Save review settings" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" }).first()).toBeVisible();
  expect((await api<Settings>("/api/settings")).review.initialReviewDelayHours).toBe(48);

  await api("/api/settings", { body: { provider: "deepseek", model: "deepseek-chat", apiKey: "e2e-own-key" } });
  await page.reload();
  await expect(page.getByLabel("First review after (hours)")).toHaveValue("48");
  // This spec's setup switched it off; it is on by default (unit-tested). There is no daily cap to set.
  const automatic = analysis.getByRole("checkbox", { name: /Analyze finished sessions automatically/ });
  await expect(analysis.getByLabel(/per day/)).toHaveCount(0);
  await automatic.check();
  await analysis.getByRole("button", { name: "Save analysis settings" }).click();
  await expect.poll(async () => (await api<Settings>("/api/settings")).analysis).toEqual({ automatic: true });
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

test("a problem's page lists its sessions and scheduling timeline, with no retired \"handled well\" control", async ({ context, api, leetcode }) => {
  const { slug, title } = await finishedSession(api, leetcode, "web-history");
  const { problem } = await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${slug}`);
  const page = await openWeb(context, `/problems/${problem!.id}`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("tab", { name: /Sessions/ }).click();
  const sessions = page.getByRole("tabpanel");
  await expect(sessions.getByText("First practice")).toBeVisible();
  await expect(sessions.getByText("3 submissions, 1 accepted", { exact: false })).toBeVisible();
  await expect(sessions.getByText(/handled well/i)).toHaveCount(0);
  await expect(sessions.getByRole("combobox")).toHaveCount(0);

  await page.getByRole("tab", { name: /History/ }).click();
  const history = page.getByRole("tabpanel");
  await expect(history.getByText("First review scheduled")).toBeVisible();
  await expect(history.getByText(/^Next review /)).toBeVisible();
  await page.close();
});

test("legacy review, Study Coach, and card controls are retired from the web", async ({ context, api, leetcode }) => {
  const page = await openWeb(context, "/review");
  await expect(page).toHaveURL(/\/today\?retired=review$/, { timeout: 30_000 });
  await expect(page.getByText("The web review page is retired.", { exact: false })).toBeVisible();
  const nav = page.getByRole("navigation").first();
  await expect(nav.getByRole("link", { name: "Review" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Suggestions" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Study Coach/ })).toHaveCount(0);

  const { slug } = await finishedSession(api, leetcode, "web-retired");
  const { problem } = await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${slug}`);
  await page.goto(`${API_ORIGIN}/problems/${problem!.id}`);
  await expect(page.getByRole("tab", { name: /Sessions/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("tab", { name: /Cards/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Practice on LeetCode" })).toHaveAttribute("href", `https://leetcode.com/problems/${slug}/`);
  await page.close();
});

test("a long problem statement uses the page's own scrolling, at desktop and phone widths", async ({ context, api }) => {
  const slug = `e2e-long-${Date.now()}`;
  const paragraphs = Array.from({ length: 80 }, (_, index) => `<p>Line ${index + 1} of a long statement.</p>`).join("");
  const captured = await api<{ problemId: string }>("/api/capture", {
    body: { leetcodeSlug: slug, title: "E2E long statement", difficulty: "Easy", url: `https://leetcode.com/problems/${slug}/`, descriptionMd: paragraphs },
  });
  const page = await openWeb(context, `/problems/${captured.problemId}`);
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const statement = page.getByRole("tabpanel");
    await expect(statement.getByText("Line 80 of a long statement.")).toBeAttached();
    const layout = await statement.evaluate((panel) => {
      // No element between the statement and the page scrolls on its own.
      const nested: string[] = [];
      for (let node = panel.parentElement; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) nested.push(node.className);
      }
      const root = document.documentElement;
      return { nested, pageScrolls: root.scrollHeight > window.innerHeight, horizontalOverflow: root.scrollWidth > window.innerWidth };
    });
    expect(layout, `at ${viewport.width}x${viewport.height}`).toEqual({ nested: [], pageScrolls: true, horizontalOverflow: false });
  }
  // The last line is reached with the page's scrollbar.
  await page.getByText("Line 80 of a long statement.").scrollIntoViewIfNeeded();
  await expect(page.getByText("Line 80 of a long statement.")).toBeInViewport();
  await page.close();
});

test("the problems table names its columns in full", async ({ context, panel }) => {
  void panel; // signs the context in
  const page = await openWeb(context, "/problems");
  await page.setViewportSize({ width: 1440, height: 900 });
  const headers = page.getByRole("columnheader");
  await expect(headers).toHaveText(["Problem", "Difficulty", "Next review", "Reviews", "Times forgotten", "Memory state"]);
  await page.getByRole("button", { name: "Times forgotten" }).click();
  await expect(page.getByRole("columnheader", { name: "Times forgotten" })).toHaveAttribute("aria-sort", "ascending");
  await page.close();
});
