import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { getDb, schema } from "@ankify/db";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStudyData } from "./study-data-reset";

const dir = await vi.hoisted(async () => {
  // Point the database singleton at a throwaway file before anything opens it.
  const [fs, os, path] = await Promise.all([import("node:fs"), import("node:os"), import("node:path")]);
  const created = fs.mkdtempSync(path.join(os.tmpdir(), "ankify-reset-"));
  process.env.LOCAL_DB_PATH = path.join(created, "test.db");
  return created;
});

const KEPT_SETTINGS = ["ai", "review", "generation", "onboarding", "leetcode-account", "leetcode-solved", "starter-ai-usage"];
const STUDY_SETTINGS = ["study-plan", "custom-study-plans", "plan-ticks", "technique-suggestions", "learner-profile"];

type CountedTable =
  | typeof schema.problems
  | typeof schema.submissions
  | typeof schema.cards
  | typeof schema.reviewEvents
  | typeof schema.weaknesses
  | typeof schema.weaknessCategories
  | typeof schema.agentSessions;

async function seedUser(userId: string) {
  const db = getDb();
  await db.insert(schema.user).values({ id: userId, name: userId, email: `${userId}@example.com` });
  const problemId = `${userId}-problem`;
  await db.insert(schema.problems).values({
    id: problemId,
    userId,
    leetcodeSlug: "two-sum",
    title: "Two Sum",
    difficulty: "Easy",
    url: "https://leetcode.com/problems/two-sum/",
  });
  await db.insert(schema.submissions).values({ id: `${userId}-submission`, userId, problemId, language: "python3", code: "pass", status: "Accepted", submittedAt: new Date() });
  await db.insert(schema.cards).values({ id: `${userId}-card`, userId, problemId, question: "q", answer: "a", aiStatus: "ready" });
  await db.insert(schema.reviewEvents).values({ id: `${userId}-event`, userId, problemId, eventType: "self_recall_rated" });
  await db.insert(schema.weaknessCategories).values({ id: `${userId}-category`, userId, key: "custom", name: "Custom", description: "d" });
  await db.insert(schema.weaknesses).values({ id: `${userId}-weakness`, userId, problemId, category: "custom", detail: "d", evidenceJson: [] });
  await db.insert(schema.agentSessions).values({ id: `${userId}-session`, userId });
  await db
    .insert(schema.settings)
    .values([...KEPT_SETTINGS, ...STUDY_SETTINGS].map((key) => ({ userId, key, value: { seeded: true } })));
}

async function rowCounts(userId: string) {
  const db = getDb();
  const count = async (table: CountedTable) =>
    (await db.select().from(table).where(eq(table.userId, userId))).length;
  return [
    await count(schema.problems),
    await count(schema.submissions),
    await count(schema.cards),
    await count(schema.reviewEvents),
    await count(schema.weaknesses),
    await count(schema.weaknessCategories),
    await count(schema.agentSessions),
  ];
}

async function settingKeys(userId: string) {
  const rows = await getDb()
    .select({ key: schema.settings.key })
    .from(schema.settings)
    .where(eq(schema.settings.userId, userId));
  return rows.map((row) => row.key).sort();
}

describe("resetStudyData", () => {
  beforeAll(async () => {
    await migrate(getDb(), { migrationsFolder: resolve(__dirname, "../../../../packages/db/drizzle") });
  });

  beforeEach(async () => {
    await getDb().delete(schema.user);
    await seedUser("alice");
    await seedUser("bob");
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("removes the user's study data", async () => {
    await resetStudyData("alice");
    expect(await rowCounts("alice")).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("keeps the account, setup, LeetCode link, and starter credit usage", async () => {
    await resetStudyData("alice");
    expect(await settingKeys("alice")).toEqual([...KEPT_SETTINGS].sort());
    expect(await getDb().select().from(schema.user).where(eq(schema.user.id, "alice"))).toHaveLength(1);
  });

  it("leaves other users alone", async () => {
    await resetStudyData("alice");
    expect(await rowCounts("bob")).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(await settingKeys("bob")).toEqual([...KEPT_SETTINGS, ...STUDY_SETTINGS].sort());
  });

  it("can run twice", async () => {
    await resetStudyData("alice");
    await expect(resetStudyData("alice")).resolves.toBeUndefined();
  });
});
