import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Route } from "@playwright/test";
import type { PracticeSessionCurrentDto, PracticeSessionListDto } from "../../packages/contracts/src";
import { API_ORIGIN, apiFrom, expect, launchExtensionContext, openSignedInPopup, test } from "./fixtures";
import { newProblem, openPanel } from "./helpers";
import { installLeetcodeFixture, problemUrl, type LeetcodeFixtureState } from "./leetcode-fixture";

const COMMANDS = "**/api/practice-sessions/*/commands";
const outage = (route: Route) => route.abort("internetdisconnected");
const capture = (state: LeetcodeFixtureState, slug: string) => ({
  body: { leetcodeSlug: slug, leetcodeId: state.problems[slug]!.frontendId, title: state.problems[slug]!.title, difficulty: "Easy", url: problemUrl(slug) },
});

test("queued work never crosses accounts", async ({ context, leetcode, api, panel }) => {
  const slug = newProblem(leetcode, "accounts");
  const page = await context.newPage();
  await page.goto(problemUrl(slug));
  await openPanel(page);
  await page.getByRole("button", { name: "Start practice" }).click();
  await expect(page.getByText("First practice in progress")).toBeVisible();
  await context.route(COMMANDS, outage);
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText("Finish saved. It syncs when ankify is reachable.")).toBeVisible();

  // Another account signs in on the web while the finish waits.
  const web = await context.newPage();
  await web.goto(`${API_ORIGIN}/api/qa/login?account=second`);
  await web.waitForURL(`${API_ORIGIN}/today`);
  await context.unroute(COMMANDS, outage);
  await panel.reload();
  await expect(panel.getByText("Nothing is due. Nice work.")).toBeVisible();
  expect(await panel.evaluate(() => chrome.runtime.sendMessage({ type: "sync_status" }))).toMatchObject({ pending: 0, otherAccounts: 1 });

  // Back on the first account, the finish is delivered.
  await web.goto(`${API_ORIGIN}/api/qa/login`);
  await web.waitForURL(`${API_ORIGIN}/today`);
  await expect.poll(async () => {
    await panel.reload();
    return (await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${slug}`)).problem?.enrollment;
  }, { timeout: 30_000, intervals: [1_000, 2_000, 3_000] }).toBe("enrolled");
});

test("a finish queued before the browser closes syncs after it reopens", async () => {
  const profile = mkdtempSync(join(tmpdir(), "ankify-profile-"));
  try {
    let context = await launchExtensionContext(profile);
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    const leetcode = await installLeetcodeFixture(context);
    const slug = newProblem(leetcode, "restart");
    await openSignedInPopup(context, extensionId);
    const page = await context.newPage();
    await page.goto(problemUrl(slug));
    await openPanel(page);
    await page.getByRole("button", { name: "Start practice" }).click();
    await expect(page.getByText("First practice in progress")).toBeVisible();
    await context.route(COMMANDS, outage);
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByText("Finish saved. It syncs when ankify is reachable.")).toBeVisible();
    await context.close();

    // Same profile: the outbox in IndexedDB and the session cookie survive.
    context = await launchExtensionContext(profile);
    await installLeetcodeFixture(context, leetcode);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    const api = apiFrom(popup);
    await expect.poll(async () => {
      await popup.reload();
      return (await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${slug}`)).problem?.enrollment;
    }, { timeout: 30_000, intervals: [1_000, 2_000, 3_000] }).toBe("enrolled");
    await context.close();
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});

test("a rating sent as the popup closes still lands", async ({ context, leetcode, api, extensionId, panel }) => {
  void panel;
  const slug = newProblem(leetcode, "closing");
  await api("/api/capture", capture(leetcode, slug));
  const page = await context.newPage();
  await page.goto(problemUrl(slug));
  await openPanel(page);
  await page.getByRole("button", { name: "Start review" }).click();
  await page.getByRole("button", { name: "End as unsuccessful" }).click();
  await expect(page.getByRole("group", { name: "How did the review go?" })).toBeVisible();

  const current = () => api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${slug}`);
  const pending = (await current()).pendingRating!;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await popup.evaluate((sessionId) => {
    void chrome.runtime.sendMessage({ type: "session_rating", sessionId, rating: 2 });
  }, pending.id);
  await popup.close();
  await expect.poll(async () => (await current()).pendingRating, { timeout: 15_000 }).toBeNull();
  const history = await api<PracticeSessionListDto>(`/api/practice-sessions?problemId=${(await current()).problem!.id}`);
  expect(history.sessions[0]).toMatchObject({ id: pending.id, rating: { disposition: "submitted" } });
});

test("the popup edits notes of the problem in the active tab", async ({ context, leetcode, api, panel }) => {
  const slug = newProblem(leetcode, "notes");
  await api("/api/capture", capture(leetcode, slug));
  const page = await context.newPage();
  await page.goto(problemUrl(slug));
  await page.bringToFront();
  // The popup looks at the active tab of its window: the LeetCode page.
  await panel.reload();
  const notes = panel.getByRole("textbox", { name: "Notes" });
  await expect(notes).toBeVisible();
  await notes.fill("Use a stack; an empty string is valid.");
  await expect(panel.getByText("Saved", { exact: true })).toBeVisible();
  const saved = await api<{ problem: { notes: string } }>(`/api/problems/by-slug/${slug}`);
  expect(saved.problem.notes).toBe("Use a stack; an empty string is valid.");
});

test("the popup and the panel follow the chosen language", async ({ context, leetcode, panel }) => {
  await panel.getByRole("button", { name: "Settings" }).click();
  await panel.getByRole("radio", { name: "中文" }).click();
  await panel.getByRole("button", { name: "返回" }).click();
  await expect(panel.getByRole("heading", { name: "待复习" })).toBeVisible();

  const slug = newProblem(leetcode, "zh");
  const page = await context.newPage();
  await page.goto(problemUrl(slug));
  await openPanel(page);
  await expect(page.getByText("这道题还不在你的 ankify 题库中。")).toBeVisible();
  await expect(page.getByRole("button", { name: "开始练习" })).toBeVisible();
});
