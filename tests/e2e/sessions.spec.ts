import type { PracticeSessionCurrentDto, PracticeSessionListDto } from "../../packages/contracts/src";
import { test, expect } from "./fixtures";
import { focus, newProblem, openPanel } from "./helpers";
import { problemUrl, submit, submitJudging } from "./leetcode-fixture";

test("a first practice from the panel schedules the first review a day later, without a rating", async ({ context, leetcode, api }) => {
  const slug = newProblem(leetcode, "first");
  const page = await context.newPage();
  await page.goto(problemUrl(slug));
  await openPanel(page);
  await expect(page.getByText("Not in your ankify deck yet.")).toBeVisible();
  await page.getByRole("button", { name: "Start practice" }).click();
  await expect(page.getByText("First practice in progress")).toBeVisible();

  submit(leetcode, slug, "Wrong Answer");
  submit(leetcode, slug, "Accepted");
  await focus(page);
  await expect(page.getByText("2 submissions, 1 accepted")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Finish" }).click();

  await expect(page.getByText(/Next review (tomorrow|in \d+ hours)/)).toBeVisible();
  await expect(page.getByRole("group", { name: "How did the review go?" })).toHaveCount(0);
  const current = await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${slug}`);
  expect(current.problem).toMatchObject({ enrollment: "enrolled", fsrsState: "new", due: false });
  expect(Date.parse(current.problem!.fsrsDue!) - Date.now()).toBeGreaterThan(23 * 3_600_000);
  const history = await api<PracticeSessionListDto>(`/api/practice-sessions?problemId=${current.problem!.id}`);
  expect(history.sessions).toMatchObject([{ type: "initial_learning", status: "completed", outcome: "accepted", rating: { disposition: "not_applicable" } }]);
});

test("a due review ended unsuccessfully is rated Again from the panel", async ({ context, leetcode, api }) => {
  const slug = newProblem(leetcode, "again");
  await api("/api/capture", { body: { leetcodeSlug: slug, leetcodeId: leetcode.problems[slug]!.frontendId, title: leetcode.problems[slug]!.title, difficulty: "Easy", url: problemUrl(slug) } });
  const page = await context.newPage();
  await page.goto(problemUrl(slug));
  await openPanel(page);
  await expect(page.getByText("Due for review.")).toBeVisible();
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByText("Review in progress")).toBeVisible();
  submit(leetcode, slug, "Wrong Answer");
  await focus(page);
  await expect(page.getByText("1 submission, 0 accepted")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "End as unsuccessful" }).click();
  const rating = page.getByRole("group", { name: "How did the review go?" });
  await expect(rating).toBeVisible();
  // Nothing is preselected.
  await expect(rating.locator("[aria-pressed=true], [aria-checked=true]")).toHaveCount(0);
  await rating.getByRole("button", { name: /Again/ }).click();
  await expect(page.getByRole("status")).toHaveText(/Next review (tomorrow|in \d+ (hours|days))/);

  const current = await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${slug}`);
  expect(current).toMatchObject({ session: null, pendingRating: null, problem: { fsrsState: "review", scheduleRevision: 1, due: false } });
  const history = await api<PracticeSessionListDto>(`/api/practice-sessions?problemId=${current.problem!.id}`);
  expect(history.sessions[0]).toMatchObject({ type: "scheduled_review", outcome: "failed", rating: { disposition: "submitted" } });
});

test("work continues after Accepted; the rating is asked at once, survives closing the page, and is given in the popup", async ({ context, leetcode, api, panel }) => {
  const slug = newProblem(leetcode, "rate-now");
  await api("/api/capture", { body: { leetcodeSlug: slug, leetcodeId: leetcode.problems[slug]!.frontendId, title: leetcode.problems[slug]!.title, difficulty: "Easy", url: problemUrl(slug) } });
  const page = await context.newPage();
  await page.goto(problemUrl(slug));
  await openPanel(page);
  await page.getByRole("button", { name: "Start review" }).click();
  submit(leetcode, slug, "Accepted");
  await focus(page);
  await expect(page.getByText("1 submission, 1 accepted")).toBeVisible({ timeout: 20_000 });
  // Accepted does not end the session; the user keeps optimizing.
  await expect(page.getByRole("button", { name: "Finish" })).toBeVisible();
  submit(leetcode, slug, "Accepted", "return 2");
  await page.getByRole("button", { name: "Finish" }).click();
  const rating = page.getByRole("group", { name: "How did the review go?" });
  await expect(rating).toBeVisible();
  // No "Rate later": rate or skip.
  await expect(rating.getByRole("button", { name: "Later" })).toHaveCount(0);
  await expect(rating.getByRole("button", { name: "Skip rating" })).toBeVisible();

  // Closing the page does not skip: the rating is back when it reopens.
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(problemUrl(slug));
  await openPanel(reopened);
  await expect(reopened.getByRole("group", { name: "How did the review go?" })).toBeVisible();

  await panel.reload();
  const card = panel.getByRole("group", { name: `How did the review go? ${leetcode.problems[slug]!.title}` });
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "Later" })).toHaveCount(0);
  await card.getByRole("button", { name: /Good/ }).click();
  await expect(card).toHaveCount(0);
  await expect(reopened.getByRole("group", { name: "How did the review go?" })).toHaveCount(0, { timeout: 5_000 });

  const current = await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${slug}`);
  const history = await api<PracticeSessionListDto>(`/api/practice-sessions?problemId=${current.problem!.id}`);
  expect(history.sessions[0]).toMatchObject({ outcome: "accepted", evidence: { submissions: 2, accepted: 2 }, rating: { disposition: "submitted" } });
});

test("another review starts only after the finished one is rated or skipped, and skipping keeps its schedule", async ({ context, leetcode, api, panel }) => {
  void panel; // signs the context in
  const capture = (slug: string) =>
    api<{ problemId: string }>("/api/capture", { body: { leetcodeSlug: slug, leetcodeId: leetcode.problems[slug]!.frontendId, title: leetcode.problems[slug]!.title, difficulty: "Easy", url: problemUrl(slug) } });
  const first = newProblem(leetcode, "unrated");
  const second = newProblem(leetcode, "blocked");
  await capture(first);
  await capture(second);

  const firstPage = await context.newPage();
  await firstPage.goto(problemUrl(first));
  await openPanel(firstPage);
  await firstPage.getByRole("button", { name: "Start review" }).click();
  await firstPage.getByRole("button", { name: "End as unsuccessful" }).click();
  await expect(firstPage.getByRole("group", { name: "How did the review go?" })).toBeVisible();
  await firstPage.close();
  const before = await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${first}`);

  const page = await context.newPage();
  await page.goto(problemUrl(second));
  await openPanel(page);
  await page.getByRole("button", { name: "Start review" }).click();
  const blocking = page.getByRole("group", { name: `How did the review go? ${leetcode.problems[first]!.title}` });
  await expect(blocking).toBeVisible();
  await expect(blocking.getByText(`Rate your review of ${leetcode.problems[first]!.title} first`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start review" })).toHaveCount(0);
  await blocking.getByRole("button", { name: "Skip rating" }).click();
  await expect(page.getByText("Done. You can start this review now.")).toBeVisible();
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByText("Review in progress")).toBeVisible();

  const after = await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${first}`);
  expect(after.problem).toMatchObject({ scheduleRevision: before.problem!.scheduleRevision, fsrsDue: before.problem!.fsrsDue });
  const history = await api<PracticeSessionListDto>(`/api/practice-sessions?problemId=${after.problem!.id}`);
  expect(history.sessions[0]).toMatchObject({ outcome: "failed", rating: { disposition: "dismissed" } });
});

test("a reloaded page keeps its session, and another tab takes over only when asked", async ({ context, leetcode, api }) => {
  const slug = newProblem(leetcode, "tabs");
  const first = await context.newPage();
  await first.goto(problemUrl(slug));
  await openPanel(first);
  await first.getByRole("button", { name: "Start practice" }).click();
  await expect(first.getByText("First practice in progress")).toBeVisible();

  await first.reload();
  await openPanel(first);
  await expect(first.getByText("First practice in progress")).toBeVisible();

  const second = await context.newPage();
  await second.goto(problemUrl(slug));
  await openPanel(second);
  await expect(second.getByText("This session is open in another tab.")).toBeVisible();
  await second.getByRole("button", { name: "Continue here" }).click();
  await expect(second.getByText("First practice in progress")).toBeVisible();

  // The first tab learns it lost control at its next heartbeat and cannot finish.
  await first.bringToFront();
  await expect(first.getByText("This session is open in another tab.")).toBeVisible({ timeout: 25_000 });
  const current = await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${slug}`);
  expect(current.session).toMatchObject({ status: "active", ownership: "other_tab" });
});

test("SPA navigation follows the problem in the URL", async ({ context, leetcode, panel }) => {
  void panel; // signs the context in
  const slug = newProblem(leetcode, "spa");
  const other = newProblem(leetcode, "spa-other");
  const page = await context.newPage();
  await page.goto(problemUrl(slug));
  await openPanel(page);
  await page.getByRole("button", { name: "Start practice" }).click();
  await expect(page.getByText("First practice in progress")).toBeVisible();

  await page.evaluate((path) => history.pushState({}, "", path), `/problems/${other}/`);
  await openPanel(page);
  await expect(page.getByText("Not in your ankify deck yet.")).toBeVisible();
  await page.evaluate((path) => history.pushState({}, "", path), `/problems/${slug}/`);
  await openPanel(page);
  await expect(page.getByText("First practice in progress")).toBeVisible();
});

test("a finish made during an outage survives a worker restart and syncs later", async ({ context, leetcode, api, panel, extensionId }) => {
  const slug = newProblem(leetcode, "outage");
  const page = await context.newPage();
  await page.goto(problemUrl(slug));
  await openPanel(page);
  await page.getByRole("button", { name: "Start practice" }).click();
  await expect(page.getByText("First practice in progress")).toBeVisible();

  // ankify's session API becomes unreachable.
  const outage = (route: import("@playwright/test").Route) => route.abort("internetdisconnected");
  await context.route("**/api/practice-sessions/*/commands", outage);
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText("Finish saved. It syncs when ankify is reachable.")).toBeVisible();

  // The worker is killed while the finish waits in the outbox.
  const cdp = await context.newCDPSession(panel);
  const { targetInfos } = await cdp.send("Target.getTargets");
  const worker = targetInfos.find((info) => info.type === "service_worker" && info.url.startsWith(`chrome-extension://${extensionId}/`));
  expect((await cdp.send("Target.closeTarget", { targetId: worker!.targetId })).success).toBe(true);
  await cdp.detach();

  await context.unroute("**/api/practice-sessions/*/commands", outage);
  // Opening the popup wakes the worker, which replays the outbox.
  await expect.poll(async () => {
    await panel.reload();
    const current = await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${slug}`);
    return current.problem?.enrollment;
  }, { timeout: 30_000, intervals: [1_000, 2_000, 3_000] }).toBe("enrolled");
  const current = await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${slug}`);
  const history = await api<PracticeSessionListDto>(`/api/practice-sessions?problemId=${current.problem!.id}`);
  expect(history.sessions).toMatchObject([{ status: "completed" }]);
});

test("a review opened from the popup starts before navigation and tracks new submissions", async ({ context, leetcode, api, panel }) => {
  const slug = newProblem(leetcode, "popup");
  submit(leetcode, slug, "Wrong Answer");
  const captured = await api<{ problemId: string }>("/api/capture", { body: { leetcodeSlug: slug, leetcodeId: leetcode.problems[slug]!.frontendId, title: leetcode.problems[slug]!.title, difficulty: "Easy", url: problemUrl(slug) } });
  const baseline = leetcode.problems[slug]!.submissions[0]!.id;

  const opened = await panel.evaluate(({ problemId, slug }) => chrome.runtime.sendMessage({ type: "open_review", problemId, slug }), { problemId: captured.problemId, slug }) as {
    ok: boolean; response: { created: boolean; session: { type: string; capture: { baselineState: string } } };
  };
  expect(opened).toMatchObject({ ok: true, response: { created: true, session: { type: "scheduled_review", capture: { baselineState: "pending" } } } });

  const current = () => api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${slug}`);
  await expect.poll(async () => (await current()).session?.capture.baselineSubmissionId, { timeout: 20_000 }).toBe(baseline);
  const tab = context.pages().find((page) => page.url().startsWith(problemUrl(slug)));
  expect(tab).toBeDefined();

  submit(leetcode, slug, "Accepted");
  await focus(tab!);
  await expect.poll(async () => (await current()).session?.evidence, { timeout: 20_000 }).toMatchObject({ submissions: 1, accepted: 1 });
  await openPanel(tab!);
  await expect(tab!.getByText("Review in progress")).toBeVisible();
});

test("a submit shows up in the panel within seconds, first as being judged, without Finish or focus", async ({ context, leetcode, panel }) => {
  void panel; // signs the context in
  const slug = newProblem(leetcode, "live");
  const page = await context.newPage();
  await page.goto(problemUrl(slug));
  await openPanel(page);
  await page.getByRole("button", { name: "Start practice" }).click();
  await expect(page.getByText("No submissions yet")).toBeVisible();

  const judging = submitJudging(leetcode, slug);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("1 submission is being judged")).toBeVisible({ timeout: 8_000 });
  judging.statusDisplay = "Wrong Answer";
  await expect(page.getByText("1 submission, 0 accepted")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("1 submission is being judged")).toHaveCount(0);
});

test("a rating in the popup clears the panel's rating, and a rating in the panel clears the popup's", async ({ context, leetcode, api, panel }) => {
  const capture = (slug: string) =>
    api("/api/capture", { body: { leetcodeSlug: slug, leetcodeId: leetcode.problems[slug]!.frontendId, title: leetcode.problems[slug]!.title, difficulty: "Easy", url: problemUrl(slug) } });
  const finishReview = async (slug: string) => {
    const page = await context.newPage();
    await page.goto(problemUrl(slug));
    await openPanel(page);
    await page.getByRole("button", { name: "Start review" }).click();
    await expect(page.getByText("Review in progress")).toBeVisible();
    await page.getByRole("button", { name: "End as unsuccessful" }).click();
    await expect(page.getByRole("group", { name: "How did the review go?" })).toBeVisible();
    return page;
  };

  // Rated in the popup: the panel leaves its rating screen and shows the schedule.
  const first = newProblem(leetcode, "sync-popup");
  await capture(first);
  const firstPage = await finishReview(first);
  await panel.reload();
  const popupCard = panel.getByRole("group", { name: `How did the review go? ${leetcode.problems[first]!.title}` });
  await popupCard.getByRole("button", { name: /Good/ }).click();
  await expect(popupCard).toHaveCount(0);
  await expect(firstPage.getByRole("group", { name: "How did the review go?" })).toHaveCount(0, { timeout: 5_000 });
  await expect(firstPage.getByText(/Next review (tomorrow|in \d+ (hours|days))/)).toBeVisible();

  // Rated in the panel: the open popup drops its card without a reload.
  const second = newProblem(leetcode, "sync-panel");
  await capture(second);
  const secondPage = await finishReview(second);
  const secondCard = panel.getByRole("group", { name: `How did the review go? ${leetcode.problems[second]!.title}` });
  await expect(secondCard).toBeVisible({ timeout: 5_000 });
  await secondPage.getByRole("group", { name: "How did the review go?" }).getByRole("button", { name: /Easy/ }).click();
  await expect(secondCard).toHaveCount(0, { timeout: 5_000 });

  const current = await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${second}`);
  const history = await api<PracticeSessionListDto>(`/api/practice-sessions?problemId=${current.problem!.id}`);
  // One rating, one schedule change.
  expect(history.sessions).toMatchObject([{ rating: { disposition: "submitted" } }]);
  expect(current.problem).toMatchObject({ scheduleRevision: 1 });
});
