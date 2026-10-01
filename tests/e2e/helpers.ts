import type { Page } from "@playwright/test";
import { expect } from "./fixtures";
import type { LeetcodeFixtureState } from "./leetcode-fixture";

// Playwright restarts its worker after a failure, which reloads this module.
// A fixed start would then reuse ids of problems already in the run's
// database, and a "new" problem would resolve to an existing one by its
// LeetCode id, so each load starts at its own offset.
let nextFrontendId = 10_000 + (Date.now() % 1_000_000) * 100;

/** A problem the QA deck has never seen, served by the LeetCode fixture. */
export function newProblem(state: LeetcodeFixtureState, name: string) {
  const slug = `e2e-${name}-${nextFrontendId}`;
  state.problems[slug] = { frontendId: nextFrontendId++, title: `E2E ${name}`, submissions: [] };
  return slug;
}

/** Expands the panel for the problem in the URL. It may auto-open when
 *  something needs attention, so converge on "expanded" instead of toggling. */
export async function openPanel(page: Page) {
  const slug = new URL(page.url()).pathname.split("/")[2];
  const pill = page.locator(`[data-ankify-panel][data-slug="${slug}"] [data-key="pill"]`);
  await expect(async () => {
    if ((await pill.getAttribute("aria-expanded")) !== "true") await pill.click();
    await expect(pill).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** Makes the page report LeetCode activity now, as regaining focus does. */
export async function focus(page: Page) {
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}
