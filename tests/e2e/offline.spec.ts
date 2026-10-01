import type { Route } from "@playwright/test";
import type { PracticeSessionCurrentDto, PracticeSessionListDto } from "../../packages/contracts/src";
import { API_ORIGIN, test, expect } from "./fixtures";
import { newProblem, openPanel } from "./helpers";
import { problemUrl, submit } from "./leetcode-fixture";

/**
 * ankify outages as the extension sees them. All ankify traffic goes through
 * the extension's service worker, so the outage is applied to the browser
 * context (which includes the worker), not to the LeetCode tab: DevTools'
 * "Offline" on a LeetCode tab only cuts LeetCode itself.
 */
const API = `${API_ORIGIN}/api/**`;
const outage = (route: Route) => route.abort("internetdisconnected");

test("an outage before starting says ankify is unreachable and creates nothing; the start works once it is back", async ({ context, leetcode, api, panel }) => {
  void panel; // signs the context in
  const slug = newProblem(leetcode, "offline-start");
  const page = await context.newPage();
  await page.goto(problemUrl(slug));
  await openPanel(page);
  await expect(page.getByText("Not in your ankify deck yet.")).toBeVisible();

  await context.route(API, outage);
  await page.getByRole("button", { name: "Start practice" }).click();
  await expect(page.getByRole("alert")).toHaveText("Can't reach ankify. Check your connection.");
  await context.unroute(API, outage);

  await page.getByRole("button", { name: "Start practice" }).click();
  await expect(page.getByText("First practice in progress")).toBeVisible();
  const current = await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${slug}`);
  const history = await api<PracticeSessionListDto>(`/api/practice-sessions?problemId=${current.problem!.id}`);
  expect(history.sessions).toHaveLength(1);
});

test("submissions and a rating made during an outage are saved, shown as waiting, and sync once when ankify is back", async ({ context, leetcode, api, panel }) => {
  const slug = newProblem(leetcode, "offline-session");
  await api("/api/capture", { body: { leetcodeSlug: slug, leetcodeId: leetcode.problems[slug]!.frontendId, title: leetcode.problems[slug]!.title, difficulty: "Easy", url: problemUrl(slug) } });
  const page = await context.newPage();
  await page.goto(problemUrl(slug));
  await openPanel(page);
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByText("Review in progress")).toBeVisible();

  // During the session: the submission counts at once and waits to sync.
  await context.route(API, outage);
  submit(leetcode, slug, "Wrong Answer");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("1 submission, 0 accepted")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("1 submission saved here, waiting to sync")).toBeVisible();

  // Back online: opening the popup replays the outbox; the page hears of it.
  await context.unroute(API, outage);
  await panel.reload();
  await expect(page.getByText("1 submission saved here, waiting to sync")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText("1 submission, 0 accepted")).toBeVisible();

  await page.getByRole("button", { name: "End as unsuccessful" }).click();
  const rating = page.getByRole("group", { name: "How did the review go?" });
  await expect(rating).toBeVisible();

  // While rating: the rating is kept and applied once when the outage ends.
  await context.route(API, outage);
  await rating.getByRole("button", { name: /Again/ }).click();
  await expect(page.getByText("Rating saved. It syncs when ankify is reachable.")).toBeVisible();
  await context.unroute(API, outage);
  await expect.poll(async () => {
    await panel.reload();
    const current = await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${slug}`);
    return current.problem?.scheduleRevision;
  }, { timeout: 30_000, intervals: [1_000, 2_000, 3_000] }).toBe(1);

  const current = await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${slug}`);
  const history = await api<PracticeSessionListDto>(`/api/practice-sessions?problemId=${current.problem!.id}`);
  expect(history.sessions).toMatchObject([{ outcome: "failed", evidence: { submissions: 1 }, rating: { disposition: "submitted" } }]);
});
