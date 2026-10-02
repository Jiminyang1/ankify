import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { API_ORIGIN, test, expect } from "./fixtures";
import { newProblem, openPanel } from "./helpers";
import { problemUrl } from "./leetcode-fixture";

/**
 * Automated accessibility checks (axe-core, WCAG 2.1 A and AA, including color
 * contrast) on every surface in both themes, plus keyboard focus visibility.
 * Serious and critical violations fail; the rest are printed for review.
 */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function audit(page: Page, label: string, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(WCAG).exclude("nextjs-portal");
  if (include) builder.include(include);
  const { violations } = await builder.analyze();
  const blocking = violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  const describe = (list: typeof violations) =>
    list.map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
  if (violations.length > blocking.length) console.log(`[a11y] ${label} minor:`, describe(violations.filter((violation) => !blocking.includes(violation))));
  expect(describe(blocking), `${label}: serious or critical axe violations`).toEqual([]);
}

const PAGES = ["/today", "/problems", "/problems/qa-problem-two-sum", "/analysis", "/suggestions", "/settings"];

for (const theme of ["light", "dark"] as const) {
  test(`web pages pass axe in ${theme}`, async ({ context, panel }) => {
    void panel; // signs the context in
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: theme });
    for (const path of PAGES) {
      await page.goto(`${API_ORIGIN}${path}`);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
      await audit(page, `${path} (${theme})`);
    }
    await page.close();
  });

  test(`the popup and the panel pass axe in ${theme}`, async ({ context, leetcode, api, panel }) => {
    await panel.emulateMedia({ colorScheme: theme });
    await panel.reload();
    await expect(panel.getByRole("heading", { name: "Due" })).toBeVisible();
    await audit(panel, `popup (${theme})`);

    const slug = newProblem(leetcode, `a11y-${theme}`);
    await api("/api/capture", { body: { leetcodeSlug: slug, leetcodeId: leetcode.problems[slug]!.frontendId, title: leetcode.problems[slug]!.title, difficulty: "Easy", url: problemUrl(slug) } });
    const page = await context.newPage();
    await page.goto(problemUrl(slug));
    await page.evaluate((value) => document.documentElement.classList.add(value), theme);
    await openPanel(page);
    await audit(page, `panel, due (${theme})`, "[data-ankify-panel]");
    await page.getByRole("button", { name: "Start review" }).click();
    await page.getByRole("button", { name: "End as unsuccessful" }).click();
    await expect(page.getByRole("group", { name: "How did the review go?" })).toBeVisible();
    await audit(page, `panel, rating (${theme})`, "[data-ankify-panel]");
    // Leave no rating pending: it would hold up the next review.
    await page.getByRole("button", { name: "Skip rating" }).click();
    await expect(page.getByRole("group", { name: "How did the review go?" })).toHaveCount(0);
    await page.close();
  });
}

test("keyboard focus is always visible", async ({ context, leetcode, panel }) => {
  const outline = (page: Page) =>
    page.evaluate(() => {
      // The focused element, inside the panel's shadow root when it is there.
      let active: Element | null = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      const style = active ? getComputedStyle(active) : null;
      return { tag: active?.tagName ?? null, outline: style ? `${style.outlineStyle} ${style.outlineWidth}` : null };
    });

  const web = await context.newPage();
  await web.goto(`${API_ORIGIN}/problems`);
  await expect(web.getByRole("columnheader", { name: "Problem" })).toBeVisible({ timeout: 30_000 });
  for (let step = 0; step < 6; step += 1) {
    await web.keyboard.press("Tab");
    const focused = await outline(web);
    expect(focused.outline, `web focus on ${focused.tag}`).not.toMatch(/^none|0px$/);
  }

  await panel.keyboard.press("Tab");
  expect((await outline(panel)).outline).not.toMatch(/^none|0px$/);

  const slug = newProblem(leetcode, "a11y-keyboard");
  const page = await context.newPage();
  await page.goto(problemUrl(slug));
  await openPanel(page);
  await page.locator('[data-ankify-panel] [data-key="start"]').focus();
  await page.keyboard.press("Tab");
  const focused = await outline(page);
  expect(["BUTTON", "A"]).toContain(focused.tag);
  expect(focused.outline).not.toMatch(/^none|0px$/);
});
