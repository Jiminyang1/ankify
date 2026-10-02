import type { MistakeProfileDto, PracticeSessionCurrentDto, SessionAnalysisStateDto } from "../../packages/contracts/src";
import { test, expect } from "./fixtures";
import { focus, newProblem, openPanel } from "./helpers";
import { problemUrl, submit, type LeetcodeFixtureState } from "./leetcode-fixture";
import type { BrowserContext } from "@playwright/test";

// The e2e server answers every analysis from a local fake provider (see
// scripts/e2e-server.mjs); no test reaches a real AI provider.
const SUMMARY = "The first attempts missed the empty string.";
const OWN_KEY = { provider: "deepseek", model: "deepseek-chat", apiKey: "e2e-own-key" };

/** Two different failed attempts, then Accepted: qualifies for automatic analysis. */
async function finishQualifyingSession(context: BrowserContext, leetcode: LeetcodeFixtureState, name: string) {
  const slug = newProblem(leetcode, name);
  const page = await context.newPage();
  await page.goto(problemUrl(slug));
  await openPanel(page);
  await page.getByRole("button", { name: "Start practice" }).click();
  await expect(page.getByText("First practice in progress")).toBeVisible();
  submit(leetcode, slug, "Wrong Answer", "return 0");
  submit(leetcode, slug, "Wrong Answer", "return -1");
  submit(leetcode, slug, "Accepted", "return len(s) % 2 == 0");
  await focus(page);
  await expect(page.getByText("3 submissions, 1 accepted")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Finish" }).click();
  return { page, slug, analysis: page.getByRole("group", { name: "Session analysis" }) };
}

async function sessionIdOf(api: <T>(path: string) => Promise<T>, slug: string) {
  const current = await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${slug}`);
  return current.recentCompleted!.id;
}

test.afterEach(async ({ api }) => {
  await api("/api/settings", { body: { analysisAutomatic: false } });
});

test("a finished session is analyzed on request, and its findings are confirmed or dismissed", async ({ context, leetcode, api }) => {
  await api("/api/settings", { body: { ...OWN_KEY, analysisAutomatic: false } });
  const { page, slug, analysis } = await finishQualifyingSession(context, leetcode, "analysis-manual");
  await expect(analysis.getByText("Uses your own AI key.")).toBeVisible();
  await analysis.getByRole("button", { name: "Analyze session" }).click();
  await expect(analysis.getByText(SUMMARY)).toBeVisible({ timeout: 30_000 });
  await expect(analysis.getByText("Suggestions count toward your profile only after you confirm them.")).toBeVisible();

  const edge = analysis.locator('[data-category="edge_case"]');
  await expect(edge.getByText("Next time: Test the empty input first.")).toBeVisible();
  await edge.getByRole("combobox", { name: "Category" }).selectOption("implementation");
  await edge.getByRole("button", { name: "Confirm" }).click();
  await expect(edge.getByText("Confirmed")).toBeVisible();
  const complexity = analysis.locator('[data-category="complexity"]');
  await complexity.getByRole("button", { name: "Dismiss" }).click();
  await expect(complexity.getByText("Dismissed")).toBeVisible();
  // Unchanged evidence needs no second analysis.
  await expect(analysis.getByRole("button", { name: /Analyze/ })).toHaveCount(0);

  const sessionId = await sessionIdOf(api, slug);
  const state = await api<SessionAnalysisStateDto>(`/api/practice-sessions/${sessionId}/analysis`);
  expect(state.job).toMatchObject({ trigger: "manual", status: "succeeded" });
  expect(state.findings.map((finding) => [finding.primaryCategory, finding.status]).sort()).toEqual([
    ["complexity", "dismissed"],
    ["implementation", "confirmed"],
  ]);
  const profile = await api<MistakeProfileDto>("/api/mistakes/profile");
  expect(profile.categories).toContainEqual(expect.objectContaining({ category: "implementation" }));
  expect(profile.candidates.filter((candidate) => candidate.practiceSessionId === sessionId)).toEqual([]);
  await page.close();
});

test("with automatic analysis on, a qualifying session is analyzed when it finishes; off, nothing runs", async ({ context, leetcode, api }) => {
  await api("/api/settings", { body: { ...OWN_KEY, analysisAutomatic: false } });
  const off = await finishQualifyingSession(context, leetcode, "analysis-off");
  await expect(off.analysis.getByRole("button", { name: "Analyze session" })).toBeVisible();
  const offState = await api<SessionAnalysisStateDto>(`/api/practice-sessions/${await sessionIdOf(api, off.slug)}/analysis`);
  expect(offState).toMatchObject({ job: null, analysis: null });

  await api("/api/settings", { body: { analysisAutomatic: true } });
  const on = await finishQualifyingSession(context, leetcode, "analysis-on");
  // Finishing never waits for the analysis: it is queued, then runs on its own.
  await expect(on.analysis.getByText(/Analysis queued|Analyzing this session/)).toBeVisible();
  await expect(on.analysis.getByText(SUMMARY)).toBeVisible({ timeout: 45_000 });
  const onState = await api<SessionAnalysisStateDto>(`/api/practice-sessions/${await sessionIdOf(api, on.slug)}/analysis`);
  expect(onState.job).toMatchObject({ trigger: "automatic", status: "succeeded" });
  expect(onState.findings).toHaveLength(2);
});

test("a review is analyzed automatically like a first practice, even when accepted at once, while its rating is asked", async ({ context, leetcode, api }) => {
  await api("/api/settings", { body: { ...OWN_KEY, analysisAutomatic: true } });
  const slug = newProblem(leetcode, "analysis-review");
  await api("/api/capture", { body: { leetcodeSlug: slug, leetcodeId: leetcode.problems[slug]!.frontendId, title: leetcode.problems[slug]!.title, difficulty: "Easy", url: problemUrl(slug) } });
  const page = await context.newPage();
  await page.goto(problemUrl(slug));
  await openPanel(page);
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByText("Review in progress")).toBeVisible();
  submit(leetcode, slug, "Accepted", "return len(s) % 2 == 0");
  await focus(page);
  await expect(page.getByText("1 submission, 1 accepted")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Finish" }).click();

  const analysis = page.getByRole("group", { name: "Session analysis" });
  await expect(page.getByRole("group", { name: "How did the review go?" })).toBeVisible();
  await expect(analysis.getByText(/Analysis queued|Analyzing this session/)).toBeVisible();
  await page.getByRole("group", { name: "How did the review go?" }).getByRole("button", { name: /Good/ }).click();
  await expect(analysis.getByText(SUMMARY)).toBeVisible({ timeout: 45_000 });
  const state = await api<SessionAnalysisStateDto>(`/api/practice-sessions/${await sessionIdOf(api, slug)}/analysis`);
  expect(state.job).toMatchObject({ trigger: "automatic", status: "succeeded" });
  await page.close();
});

test("without the user's own key, the panel explains and starts nothing", async ({ context, leetcode, api }) => {
  await api("/api/settings", { body: { ...OWN_KEY, apiKey: "" } });
  const { analysis, slug } = await finishQualifyingSession(context, leetcode, "analysis-no-key");
  await expect(analysis.getByText("Add your own AI key in ankify settings to analyze sessions.")).toBeVisible();
  await expect(analysis.getByRole("link", { name: "Open settings" })).toHaveAttribute("href", "http://localhost:4317/settings");
  await expect(analysis.getByRole("button", { name: "Analyze session" })).toHaveCount(0);
  const state = await api<SessionAnalysisStateDto>(`/api/practice-sessions/${await sessionIdOf(api, slug)}/analysis`);
  expect(state).toMatchObject({ job: null, manual: { available: false, reason: "own_key_required" } });
});


test("on the web, a session is analyzed from its problem page; findings are corrected, confirmed, or dismissed, and manual entry is secondary", async ({ context, leetcode, api }) => {
  await api("/api/settings", { body: { ...OWN_KEY, analysisAutomatic: false } });
  const { page: panelPage, slug } = await finishQualifyingSession(context, leetcode, "analysis-web");
  // The finish has landed once the first review is scheduled.
  await expect(panelPage.getByText(/Next review/).first()).toBeVisible();
  await panelPage.close();
  const current = await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${slug}`);
  const page = await context.newPage();
  await page.goto(`http://localhost:4317/problems/${current.problem!.id}`);

  await page.getByRole("tab", { name: /Sessions/ }).click();
  const analysis = page.getByRole("tabpanel").getByRole("group", { name: "Session analysis" });
  await analysis.getByRole("button", { name: "Analyze session" }).click();
  await expect(analysis.getByText(SUMMARY)).toBeVisible({ timeout: 30_000 });

  const edge = analysis.getByRole("listitem").filter({ hasText: "An empty input returned the wrong value." });
  await expect(edge.getByText("Next time: Test the empty input first.")).toBeVisible();
  await edge.getByRole("combobox", { name: "Category of this mistake" }).click();
  await page.getByRole("option", { name: "Implementation" }).click();
  await edge.getByRole("button", { name: "Confirm" }).click();
  await expect(edge.getByText("Corrected from Edge cases")).toBeVisible();
  await expect(edge.getByText("Confirmed")).toBeVisible();
  const complexity = analysis.getByRole("listitem").filter({ hasText: "The first version rescanned the string." });
  await complexity.getByRole("button", { name: "Dismiss" }).click();
  await expect(complexity.getByText("Dismissed")).toBeVisible();

  await page.getByRole("tab", { name: /Mistakes/ }).click();
  const mistakes = page.getByRole("tabpanel");
  await expect(mistakes.getByRole("region", { name: "Suggested by analysis" })).toHaveCount(0);
  const record = mistakes.getByRole("listitem").filter({ hasText: "An empty input returned the wrong value." });
  await expect(record.getByText("From analysis")).toBeVisible();
  await expect(record.getByText("Corrected from Edge cases")).toBeVisible();
  // Manual entry stays available, as a plain link rather than the main action.
  await expect(mistakes.getByRole("button", { name: "Add a mistake manually" })).toBeVisible();
  await expect(mistakes.getByRole("button", { name: "Record mistake" })).toHaveCount(0);
  await page.close();
});

test("automatic analysis finishes after the LeetCode tab is closed; the result is on the problem page later", async ({ context, leetcode, api }) => {
  await api("/api/settings", { body: { ...OWN_KEY, analysisAutomatic: true } });
  const { page: panelPage, slug, analysis } = await finishQualifyingSession(context, leetcode, "analysis-closed");
  // Finishing does not wait for the analysis: the tab is closed while it is only queued.
  await expect(analysis.getByText(/Analysis queued/)).toBeVisible();
  await panelPage.close();

  const sessionId = await sessionIdOf(api, slug);
  await expect.poll(async () => (await api<SessionAnalysisStateDto>(`/api/practice-sessions/${sessionId}/analysis`)).job?.status, { timeout: 45_000, intervals: [1_000, 2_000] }).toBe("succeeded");

  const current = await api<PracticeSessionCurrentDto>(`/api/practice-sessions/current?slug=${slug}`);
  const page = await context.newPage();
  await page.goto(`http://localhost:4317/problems/${current.problem!.id}`);
  await page.getByRole("tab", { name: /Mistakes/ }).click();
  const suggested = page.getByRole("tabpanel").getByRole("region", { name: "Suggested by analysis" });
  await expect(suggested.getByText("An empty input returned the wrong value.")).toBeVisible();
  await page.close();
});
