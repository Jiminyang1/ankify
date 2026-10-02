import type { Page } from "@playwright/test";
import { API_ORIGIN, test, expect } from "../e2e/fixtures";
import { newProblem, openPanel } from "../e2e/helpers";
import { problemUrl } from "../e2e/leetcode-fixture";

/**
 * Screenshots of every surface in both themes, on the deterministic QA seed.
 * Baselines live in tests/visual/__screenshots__ and are accepted only after
 * a person (or the agent making the change) has looked at them.
 */

type Theme = "light" | "dark";
const THEMES: Theme[] = ["light", "dark"];

/** LeetCode's own theme, as its switcher sets it on the root element. */
async function leetcodeTheme(page: Page, theme: Theme) {
  await page.evaluate((value) => {
    document.documentElement.className = value;
    document.documentElement.style.colorScheme = value;
    document.body.style.background = value === "dark" ? "#1a1a1a" : "#ffffff";
    document.body.style.color = value === "dark" ? "#eff1f6" : "#262626";
  }, theme);
}

const panelHost = (page: Page) => page.locator("[data-ankify-panel]");

/** Text that changes with the calendar day: absolute dates and chart day labels. */
const dated = (page: Page) => [
  page.locator("time"),
  page.getByText(/^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s?(AM|PM)$/),
  page.getByText(/^\d{2}\/\d{2}$/),
];

/** The Next.js dev overlay counts React's dev-only "eval() is not supported"
 *  CSP warning as an issue; it is not part of the app, so it stays out of shots. */
async function hideDevOverlay(page: Page) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

// Pages and the popup are captured first, on the seed alone; the panel tests
// add problems (with run-specific LeetCode ids) at the end.

test.describe("popup", () => {
  for (const theme of THEMES) {
    test(`popup with data and empty, ${theme}`, async ({ context, extensionId, panel }) => {
      await panel.emulateMedia({ colorScheme: theme });
      await panel.setViewportSize({ width: 360, height: 600 });
      await panel.reload();
      await expect(panel.getByRole("heading", { name: "Due" })).toBeVisible();
      await expect(panel.getByRole("region", { name: "Try something new" }).getByRole("group")).toHaveCount(1);
      await expect(panel).toHaveScreenshot(`popup-full-${theme}.png`);

      const web = await context.newPage();
      await web.goto(`${API_ORIGIN}/api/qa/login?account=second`);
      await web.waitForURL(`${API_ORIGIN}/today`);
      const empty = await context.newPage();
      await empty.emulateMedia({ colorScheme: theme });
      await empty.setViewportSize({ width: 360, height: 600 });
      await empty.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await expect(empty.getByText("No new problem to suggest yet. Problems you practice bring similar ones.")).toBeVisible();
      await expect(empty).toHaveScreenshot(`popup-empty-${theme}.png`);
      await web.goto(`${API_ORIGIN}/api/qa/login`);
    });
  }
});

const PAGES: { name: string; path: string; ready: (page: Page) => Promise<void> }[] = [
  { name: "today", path: "/today", ready: async (page) => void (await expect(page.getByRole("heading", { level: 1 })).toBeVisible()) },
  { name: "problems", path: "/problems", ready: async (page) => void (await expect(page.getByRole("columnheader", { name: "Problem" })).toBeVisible()) },
  { name: "problem", path: "/problems/qa-problem-two-sum", ready: async (page) => void (await expect(page.getByRole("heading", { level: 1, name: /Two Sum/ })).toBeVisible()) },
  { name: "analysis", path: "/analysis", ready: async (page) => void (await expect(page.getByRole("region", { name: "Mistake profile" })).toBeVisible()) },
  { name: "suggestions", path: "/suggestions", ready: async (page) => void (await expect(page.getByRole("heading", { level: 1 })).toBeVisible()) },
  { name: "settings", path: "/settings", ready: async (page) => void (await expect(page.getByRole("region", { name: "Session analysis" })).toBeVisible()) },
];

test.describe("web app", () => {
  for (const theme of THEMES) {
    test(`pages at desktop width, ${theme}`, async ({ context, panel }) => {
      void panel; // signs the context in
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: 1440, height: 900 });
      for (const { name, path, ready } of PAGES) {
        await page.goto(`${API_ORIGIN}${path}`);
        await hideDevOverlay(page);
        await ready(page);
        await expect(page).toHaveScreenshot(`web-${name}-${theme}.png`, { fullPage: true, mask: dated(page) });
      }
      await page.close();
    });
  }

  test("pages at phone width", async ({ context, panel }) => {
    void panel;
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const { name, path, ready } of PAGES.filter((item) => ["today", "problems", "problem"].includes(item.name))) {
      await page.goto(`${API_ORIGIN}${path}`);
      await hideDevOverlay(page);
      await ready(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} has no horizontal scroll`).toBe(true);
      await expect(page).toHaveScreenshot(`web-${name}-phone.png`, { fullPage: true, mask: dated(page) });
    }
    await page.close();
  });
});

test.describe("embedded panel", () => {
  for (const theme of THEMES) {
    test(`panel states follow LeetCode's ${theme} theme`, async ({ context, leetcode, api }) => {
      // A problem in the deck and due, so the panel opens by itself.
      const due = newProblem(leetcode, `visual-${theme}`);
      leetcode.problems[due]!.title = "Longest Palindromic Substring";
      await api("/api/capture", { body: { leetcodeSlug: due, leetcodeId: leetcode.problems[due]!.frontendId, title: "Longest Palindromic Substring", difficulty: "Medium", url: problemUrl(due) } });
      const page = await context.newPage();
      await page.setViewportSize({ width: 1280, height: 800 });

      // Collapsed: a problem new to ankify.
      await page.goto(problemUrl("valid-parentheses"));
      await leetcodeTheme(page, theme);
      await expect(panelHost(page)).toHaveAttribute("data-theme", theme);
      await expect(panelHost(page).locator('[data-key="pill"]')).toContainText("New problem");
      await expect(page).toHaveScreenshot(`panel-collapsed-${theme}.png`);

      // Expanded: the due review offered at once.
      await page.goto(problemUrl(due));
      await leetcodeTheme(page, theme);
      await openPanel(page);
      await expect(page.getByText("Due for review.")).toBeVisible();
      await expect(page).toHaveScreenshot(`panel-due-${theme}.png`);

      // Active review.
      await page.getByRole("button", { name: "Start review" }).click();
      await expect(page.getByText("Review in progress")).toBeVisible();
      await expect(page).toHaveScreenshot(`panel-active-${theme}.png`, { mask: [page.getByText(/min active/)] });

      // The rating asked for right after Finish.
      await page.getByRole("button", { name: "End as unsuccessful" }).click();
      await expect(page.getByRole("group", { name: "How did the review go?" })).toBeVisible();
      await expect(page).toHaveScreenshot(`panel-rating-${theme}.png`, { mask: [page.getByText(/or it lapses/)] });

      // Rated: the next review is shown.
      await page.getByRole("group", { name: "How did the review go?" }).getByRole("button", { name: /Good/ }).click();
      await expect(page.getByText(/Next review/).first()).toBeVisible();
      await expect(page).toHaveScreenshot(`panel-rated-${theme}.png`, { mask: [page.getByText(/Next review/)] });
      await page.close();
    });
  }
});
