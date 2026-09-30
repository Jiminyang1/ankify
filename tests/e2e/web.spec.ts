import type { BrowserContext, Page } from "@playwright/test";
import { API_ORIGIN, test, expect } from "./fixtures";

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

test("settings read in Chinese", async ({ context, panel }) => {
  // The popup fixture signed this context in.
  await expect(panel).toHaveURL(/popup/);
  const page = await openWeb(context, "/settings", "zh");
  await expect(page.getByRole("region", { name: "练习分析" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("首次复习间隔（小时）")).toBeVisible();
  await page.close();
});
