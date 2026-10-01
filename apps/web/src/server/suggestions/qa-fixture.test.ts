import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@ankify/db";
import { ELIGIBLE_SUGGESTION_SLUGS, seedSuggestionFixture, SUGGESTION_SIMILAR_SLUGS } from "../../../scripts/suggestion-fixture";
import { loadMistakeProfile } from "../mistake-profile";
import { createTestDb } from "../test-db";
import { actOnSuggestion, allocateSuggestion } from "./commands";

// The QA deck's suggestion fixture (scripts/suggestion-fixture.ts) must keep
// making the personalized lane, every exclusion, and exhaustion testable.
const testDb = createTestDb();
const USER = "qa-fixture-user";
const EMPTY = "qa-fixture-empty";
const now = new Date();
const DECK = [
  { id: "qa-problem-two-sum", slug: "two-sum", title: "Two Sum", difficulty: "Easy" as const, topicTags: ["Array", "Hash Table"] },
  { id: "qa-problem-binary-search", slug: "binary-search", title: "Binary Search", difficulty: "Easy" as const, topicTags: ["Array", "Binary Search"] },
  { id: "qa-problem-lru-cache", slug: "lru-cache", title: "LRU Cache", difficulty: "Medium" as const, topicTags: ["Hash Table", "Linked List", "Design"] },
];
const EXCLUDED = ["two-sum-iii-data-structure-design", "first-bad-version", "binary-search", "two-sum", "lru-cache"];

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values([
    { id: USER, name: "QA", email: "qa-fixture@example.test" },
    { id: EMPTY, name: "Second", email: "qa-fixture-empty@example.test" },
  ]);
  await getDb().transaction(async (tx) => {
    await tx.insert(schema.problems).values(
      DECK.map((problem) => ({
        id: problem.id,
        userId: USER,
        leetcodeSlug: problem.slug,
        title: problem.title,
        difficulty: problem.difficulty,
        url: `https://leetcode.com/problems/${problem.slug}/`,
        topicTags: problem.topicTags,
        similarSlugs: SUGGESTION_SIMILAR_SLUGS[problem.slug]!,
        fsrsState: "review" as const,
        fsrsDue: new Date(now.getTime() + 86_400_000),
      })),
    );
    await seedSuggestionFixture(tx, USER, now);
  });
});
afterAll(() => testDb.cleanup());

describe("QA suggestion fixture", () => {
  it("makes the profile personalized with a weak, ready edge-case dimension", async () => {
    const profile = await loadMistakeProfile(USER, now);
    expect(profile.readiness).toMatchObject({ personalized: true, completedSessions: 3, distinctProblems: 3 });
    expect(profile.categories.find((item) => item.category === "edge_case")).toMatchObject({ weak: true, ready: true, contexts: 3, problems: 3 });
  });

  it("suggests a personalized edge-case problem first, then only eligible ones, until none are left", async () => {
    const first = await allocateSuggestion(USER, { requestId: crypto.randomUUID(), kind: "daily" }, now);
    if (!first.ok || !first.response.suggestion) throw new Error("no daily suggestion");
    expect(first.response.suggestion).toMatchObject({ lane: "personalized", category: "edge_case" });
    expect(first.response.suggestion.reasons).toContainEqual(expect.objectContaining({ code: "similar_to" }));

    const seen = [first.response.suggestion.target.slug];
    for (let index = 0; index < 10; index += 1) {
      const next = await allocateSuggestion(USER, { requestId: crypto.randomUUID(), kind: "extra" }, now);
      if (!next.ok) throw new Error(next.error);
      if (!next.response.suggestion) {
        expect(next.response).toMatchObject({ suggestion: null, reason: "no_candidates" });
        break;
      }
      seen.push(next.response.suggestion.target.slug);
    }
    expect([...seen].sort()).toEqual([...ELIGIBLE_SUGGESTION_SLUGS].sort());
    for (const slug of EXCLUDED) expect(seen).not.toContain(slug);
  });

  it("marks a suggestion already attempted for good", async () => {
    const result = await actOnSuggestion(USER, (await getDb().select().from(schema.suggestions))[0]!.id, { requestId: crypto.randomUUID(), action: "already_attempted" }, now);
    expect(result.ok).toBe(true);
    const history = await getDb().select().from(schema.attemptHistory);
    expect(history.map((row) => row.source).sort()).toEqual(["leetcode_status", "user_marked"]);
  });

  it("leaves the second account with nothing to suggest", async () => {
    expect(await allocateSuggestion(EMPTY, { requestId: crypto.randomUUID(), kind: "daily" }, now)).toMatchObject({ ok: true, response: { suggestion: null, reason: "no_candidates" } });
  });
});
