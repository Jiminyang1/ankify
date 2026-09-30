import type { CaptureProblemInput } from "../../packages/contracts/src";
import { test, expect } from "./fixtures";
import { fixtureSlug, fixtureUrl } from "./leetcode-fixture";

test("shows the sign-in state without a QA session", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await expect(page.getByRole("heading", { name: "Connect ankify" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("shows today's reviews once signed in", async ({ panel }) => {
  await expect(panel.getByRole("heading", { name: "Due" })).toBeVisible();
  // The QA deck's seeded problems are due.
  await expect(panel.getByRole("button", { name: /Two Sum/ })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Open dashboard" })).toBeVisible();
});

test("imports past submissions of a problem already in the deck", async ({ context, leetcode, api }) => {
  void leetcode;
  await api("/api/capture", { body: { leetcodeSlug: fixtureSlug, leetcodeId: 20, title: "Valid Parentheses", difficulty: "Easy", url: fixtureUrl } satisfies Partial<CaptureProblemInput> });
  const page = await context.newPage();
  await page.goto(fixtureUrl);
  await page.locator('[data-ankify-panel] [data-key="pill"]').click();
  await page.getByRole("button", { name: "Import past submissions" }).click();
  // 9001 withholds its details on LeetCode and is skipped.
  await expect(page.getByRole("status")).toHaveText("Imported 2 submissions.");
  await page.getByRole("button", { name: "Import past submissions" }).click();
  await expect(page.getByRole("status")).toHaveText("No new submissions to import.");
});
