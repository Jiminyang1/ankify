import type { BrowserContext, Page } from "@playwright/test";
import type { SuggestionListDto } from "../../packages/contracts/src";
import { API_ORIGIN, test, expect } from "./fixtures";
import { newProblem } from "./helpers";

// Web surfaces of the extension-first workflow, signed in as the QA user
// (the `panel` fixture signs in through /api/qa/login).
type Settings = { review: { dailyReviewLimit: number; initialReviewDelayHours: number }; analysis: { automatic: boolean; dailyAutomaticLimit: number } };

async function openWeb(context: BrowserContext, path: string, language: "en" | "zh" = "en"): Promise<Page> {
  await context.addCookies([{ name: "ankify-language", value: language, url: API_ORIGIN }]);
  const page = await context.newPage();
  await page.goto(`${API_ORIGIN}${path}`);
  return page;
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
