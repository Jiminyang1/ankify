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
  await api("/api/settings", { body: OWN_KEY });
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
  await expect(on.analysis.getByText(SUMMARY)).toBeVisible({ timeout: 30_000 });
  const onState = await api<SessionAnalysisStateDto>(`/api/practice-sessions/${await sessionIdOf(api, on.slug)}/analysis`);
  expect(onState.job).toMatchObject({ trigger: "automatic", status: "succeeded" });
  expect(onState.findings).toHaveLength(2);
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

