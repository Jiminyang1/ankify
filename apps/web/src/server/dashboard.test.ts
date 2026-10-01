import { afterAll, beforeAll, expect, it } from "vitest";
import { getDb, schema } from "@ankify/db";
import { loadDashboard } from "./dashboard";
import { ingestSessionObservations, runSessionCommand, startPracticeSession } from "./practice-sessions/commands";
import { createTestDb } from "./test-db";

const testDb = createTestDb();
const USER = "dashboard-user";
const OTHER = "dashboard-other";
const TAB = "aaaaaaaa-0000-4000-8000-00000000000a";
const MIN = 60_000;
const NOW = new Date();
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MIN);

/** A first practice finished (or abandoned) at the given time. */
async function practiced(userId: string, slug: string, verdict: "Accepted" | "Wrong Answer" | null, startedMinutesAgo: number) {
  const startAt = ago(startedMinutesAgo);
  const started = await startPracticeSession(userId, {
    requestId: crypto.randomUUID(), ownerToken: TAB, mode: "practice", baseline: { state: "none" }, supersedePendingRating: false,
    target: { kind: "leetcode", problem: { leetcodeSlug: slug, title: `Title ${slug}`, difficulty: "Easy", url: `https://leetcode.com/problems/${slug}/`, topicTags: [], similarSlugs: [] } },
  }, startAt);
  if (!started.ok) throw new Error(started.error);
  const { id } = started.response.session;
  const at = (offset: number) => new Date(startAt.getTime() + offset * MIN);
  if (verdict === null) {
    await runSessionCommand(userId, id, { type: "abandon", requestId: crypto.randomUUID(), ownerToken: TAB, occurredAt: at(2).toISOString() }, at(2));
    return;
  }
  await ingestSessionObservations(userId, id, { observations: [{ leetcodeSubmissionId: String(Math.floor(Math.random() * 1e9)), verdict, submittedAt: at(1).toISOString(), detailUnavailable: true }] }, at(1));
  await runSessionCommand(userId, id, { type: "finish", requestId: crypto.randomUUID(), ownerToken: TAB, result: verdict === "Accepted" ? "solved" : "unsuccessful", occurredAt: at(2).toISOString() }, at(2));
}

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values([
    { id: USER, name: "Owner", email: "dashboard@example.test" },
    { id: OTHER, name: "Other", email: "dashboard-other@example.test" },
  ]);
});
afterAll(() => testDb.cleanup());

it("counts the last week's completed sessions by outcome and lists recent practice, per user", async () => {
  await practiced(USER, "old-one", "Accepted", 8 * 24 * 60);
  await practiced(USER, "solved-one", "Accepted", 60);
  await practiced(USER, "failed-one", "Wrong Answer", 40);
  await practiced(USER, "left-one", null, 20);
  await practiced(OTHER, "their-one", "Accepted", 10);

  const dashboard = await loadDashboard(USER, NOW);
  expect(dashboard.week).toEqual({ completed: 2, accepted: 1, failed: 1 });
  expect(dashboard.recent.map(({ title, status, outcome }) => [title, status, outcome])).toEqual([
    ["Title left-one", "abandoned", null],
    ["Title failed-one", "completed", "failed"],
    ["Title solved-one", "completed", "accepted"],
    ["Title old-one", "completed", "accepted"],
  ]);
  expect(dashboard.profile).toEqual({ personalized: true, focus: [] });
  expect(dashboard.pendingSuggestions).toBe(0);
  expect((await loadDashboard(OTHER, NOW)).recent.map((session) => session.title)).toEqual(["Title their-one"]);
});
