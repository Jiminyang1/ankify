import type { SuggestionListDto } from "../../packages/contracts/src";
import { API_ORIGIN, test, expect } from "./fixtures";
import { focus, openPanel } from "./helpers";
import { submit } from "./leetcode-fixture";

// Suggestions come only from verified metadata. The QA seed
// (apps/web/scripts/suggestion-fixture.ts) gives the deck practice history,
// confirmed mistakes, and similar-question candidates, some of them excluded
// on purpose. Earlier specs may add more candidates, so this spec acts on
// whatever is suggested and checks the exclusions.
const EXCLUDED = ["two-sum-iii-data-structure-design", "first-bad-version", "binary-search", "two-sum", "lru-cache"];
let nextFrontendId = 990_000 + (Date.now() % 1_000) * 10;

test("suggests new problems from the seeded history; skip, another, already attempted, and start practice", async ({ context, panel, leetcode, api }) => {
  await panel.reload();
  const section = panel.getByRole("region", { name: "Try something new" });
  const cards = section.getByRole("group");
  await expect(cards).toHaveCount(1);
  await expect(section.getByText("Not checked against your LeetCode history.")).toBeVisible();
  const list = async () => (await api<SuggestionListDto>("/api/suggestions")).suggestions;
  const daily = (await cards.first().getAttribute("aria-label"))!;

  // Skip: the replacement takes its place.
  await section.getByRole("group", { name: daily }).getByRole("button", { name: "Skip" }).click();
  await expect(section.getByRole("group", { name: daily })).toHaveCount(0);
  await expect(cards).toHaveCount(1);
  const replacement = (await cards.first().getAttribute("aria-label"))!;
  expect(replacement).not.toBe(daily);

  // Another one, then mark it already attempted: it never comes back.
  await section.getByRole("button", { name: "Another suggestion" }).click();
  await expect(cards).toHaveCount(2);
  const another = (await cards.nth(1).getAttribute("aria-label"))!;
  await section.getByRole("group", { name: another }).getByRole("button", { name: "Already attempted" }).click();
  await expect(section.getByRole("group", { name: another })).toHaveCount(0);

  // Start practice: the problem opens with its first practice running.
  const target = (await list()).find((suggestion) => suggestion.target.title === replacement)!.target;
  leetcode.problems[target.slug] = { frontendId: nextFrontendId++, title: target.title, submissions: [] };
  const [page] = await Promise.all([
    context.waitForEvent("page", (opened) => opened.url().includes(`/problems/${target.slug}/`)),
    section.getByRole("group", { name: replacement }).getByRole("button", { name: "Start practice" }).click(),
  ]);
  await openPanel(page);
  await expect(page.getByText("First practice in progress")).toBeVisible();
  submit(leetcode, target.slug, "Accepted", "return 42");
  await focus(page);
  await expect(page.getByText("1 submission, 1 accepted")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Finish" }).click();

  await expect.poll(async () => (await list()).map((suggestion) => [suggestion.target.title, suggestion.status, suggestion.outcome]), { timeout: 20_000 }).toEqual(
    expect.arrayContaining([
      [daily, "skipped", null],
      [replacement, "started", "accepted"],
      [another, "already_attempted", null],
    ]),
  );
  // Practiced, paid-only, and already-solved problems are never suggested.
  for (const suggestion of await list()) expect(EXCLUDED).not.toContain(suggestion.target.slug);
  await panel.reload();
  await expect(section.getByRole("group", { name: replacement }).getByText("Solved")).toBeVisible();
  await page.close();
});

test("an account with no practice history sees a clear empty state", async ({ context, extensionId }) => {
  const web = await context.newPage();
  await web.goto(`${API_ORIGIN}/api/qa/login?account=second`);
  await web.waitForURL(`${API_ORIGIN}/today`);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  const section = popup.getByRole("region", { name: "Try something new" });
  await expect(section.getByText("No new problem to suggest yet. Problems you practice bring similar ones.")).toBeVisible({ timeout: 15_000 });
  await expect(section.getByRole("group")).toHaveCount(0);
  await web.goto(`${API_ORIGIN}/api/qa/login`);
});
