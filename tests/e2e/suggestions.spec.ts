import type { SuggestionListDto } from "../../packages/contracts/src";
import { test, expect } from "./fixtures";
import { focus, newProblem, openPanel } from "./helpers";
import { submit } from "./leetcode-fixture";

// Suggestions come only from verified metadata: here, the similar questions of
// a captured problem, each also served by the LeetCode fixture.
test("suggests new problems, replaces skipped ones, and starts practice from the popup", async ({ context, panel, leetcode, api }) => {
  const targets = ["alpha", "beta", "gamma", "delta"].map((name) => newProblem(leetcode, `suggest-${name}`));
  const parent = newProblem(leetcode, "suggest-parent");
  await api("/api/capture", {
    body: {
      leetcodeSlug: parent, title: "E2E suggest-parent", difficulty: "Easy", url: `https://leetcode.com/problems/${parent}/`,
      topicTags: ["E2E Suggestions"], similarSlugs: targets,
      similarQuestions: targets.map((slug) => ({ slug, title: leetcode.problems[slug]!.title, difficulty: "Easy", paidOnly: false })),
    },
  });
  await panel.reload();
  const section = panel.getByRole("region", { name: "Try something new" });
  const cards = section.getByRole("group");
  await expect(cards).toHaveCount(1);
  await expect(section.getByText("Not checked against your LeetCode history.")).toBeVisible();
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
  const slug = targets.find((target) => leetcode.problems[target]!.title === replacement)!;
  const [page] = await Promise.all([
    context.waitForEvent("page", (opened) => opened.url().includes(`/problems/${slug}/`)),
    section.getByRole("group", { name: replacement }).getByRole("button", { name: "Start practice" }).click(),
  ]);
  await openPanel(page);
  await expect(page.getByText("First practice in progress")).toBeVisible();
  submit(leetcode, slug, "Accepted", "return 42");
  await focus(page);
  await expect(page.getByText("1 submission, 1 accepted")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Finish" }).click();

  await expect.poll(async () => {
    const { suggestions } = await api<SuggestionListDto>("/api/suggestions");
    return suggestions.map((suggestion) => [suggestion.target.title, suggestion.status, suggestion.outcome]);
  }, { timeout: 20_000 }).toEqual(expect.arrayContaining([
    [daily, "skipped", null],
    [replacement, "started", "accepted"],
    [another, "already_attempted", null],
  ]));
  await panel.reload();
  await expect(section.getByRole("group", { name: replacement }).getByText("Solved")).toBeVisible();
  await page.close();
});
