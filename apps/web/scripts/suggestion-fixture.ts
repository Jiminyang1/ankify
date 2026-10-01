import { schema } from "@ankify/db";
import type { getDb } from "@ankify/db";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Deterministic new-problem suggestion data for the QA deck, so suggestions
 * can be tested without opening LeetCode or generating the global catalog.
 *
 * - The deck's practiced problems list similar questions (as LeetCode does),
 *   and each similar question is a verified candidate with its metadata.
 * - Three completed practice sessions across three problems, each with a
 *   confirmed edge-case mistake, make the profile personalized and the
 *   edge-case dimension weak and ready, so the personalized lane fires.
 * - Exclusions are present on purpose: a paid-only candidate, one the user
 *   already solved on LeetCode (attempt history), and one that is a problem
 *   in the deck. Five candidates remain eligible.
 *
 * The second QA account gets none of this: it shows the empty state.
 */
export const SUGGESTION_SIMILAR_SLUGS: Record<string, string[]> = {
  "two-sum": ["three-sum", "two-sum-ii-input-array-is-sorted", "two-sum-iii-data-structure-design"],
  "binary-search": ["search-insert-position", "find-first-and-last-position-of-element-in-sorted-array", "first-bad-version", "binary-search"],
  "lru-cache": ["lfu-cache"],
};

export const ELIGIBLE_SUGGESTION_SLUGS = [
  "three-sum",
  "two-sum-ii-input-array-is-sorted",
  "search-insert-position",
  "find-first-and-last-position-of-element-in-sorted-array",
  "lfu-cache",
];

const CANDIDATES: { slug: string; title: string; difficulty: "Easy" | "Medium" | "Hard"; paidOnly: boolean; topicTags: string[] }[] = [
  { slug: "three-sum", title: "3Sum", difficulty: "Medium", paidOnly: false, topicTags: ["Array", "Two Pointers", "Sorting"] },
  { slug: "two-sum-ii-input-array-is-sorted", title: "Two Sum II - Input Array Is Sorted", difficulty: "Medium", paidOnly: false, topicTags: ["Array", "Two Pointers", "Binary Search"] },
  { slug: "search-insert-position", title: "Search Insert Position", difficulty: "Easy", paidOnly: false, topicTags: ["Array", "Binary Search"] },
  { slug: "find-first-and-last-position-of-element-in-sorted-array", title: "Find First and Last Position of Element in Sorted Array", difficulty: "Medium", paidOnly: false, topicTags: ["Array", "Binary Search"] },
  { slug: "lfu-cache", title: "LFU Cache", difficulty: "Hard", paidOnly: false, topicTags: ["Hash Table", "Linked List", "Design", "Doubly-Linked List"] },
  // Excluded: paid only.
  { slug: "two-sum-iii-data-structure-design", title: "Two Sum III - Data structure design", difficulty: "Easy", paidOnly: true, topicTags: ["Array", "Hash Table", "Design"] },
  // Excluded: already accepted on LeetCode (attempt history).
  { slug: "first-bad-version", title: "First Bad Version", difficulty: "Easy", paidOnly: false, topicTags: ["Binary Search", "Interactive"] },
  // Excluded: a problem in the deck.
  { slug: "binary-search", title: "Binary Search", difficulty: "Easy", paidOnly: false, topicTags: ["Array", "Binary Search"] },
];

const SESSIONS = [
  { id: "qa-session-two-sum", problemId: "qa-problem-two-sum", daysAgo: 8, outcome: "failed" as const },
  { id: "qa-session-binary-search", problemId: "qa-problem-binary-search", daysAgo: 6, outcome: "failed" as const },
  { id: "qa-session-lru-cache", problemId: "qa-problem-lru-cache", daysAgo: 5, outcome: "accepted" as const },
];

export async function seedSuggestionFixture(tx: Tx, userId: string, now: Date) {
  const ago = (days: number, minutes = 0) => new Date(now.getTime() - days * 86_400_000 + minutes * 60_000);

  await tx.insert(schema.practiceSessions).values(
    SESSIONS.map((session, index) => ({
      id: session.id,
      userId,
      problemId: session.problemId,
      requestId: `qa-suggestion-session-${index}`,
      // Extra practice: it never changes the deck's schedule or asks for a rating.
      type: "voluntary_practice" as const,
      reviewIntent: "none" as const,
      status: "completed" as const,
      isOpen: false,
      outcome: session.outcome,
      scheduleRevisionAtStart: 0,
      baselineState: "none" as const,
      activeMs: 18 * 60_000,
      observedMs: 20 * 60_000,
      startedAt: ago(session.daysAgo),
      lastActivityAt: ago(session.daysAgo, 20),
      completedAt: ago(session.daysAgo, 20),
      completionReceivedAt: ago(session.daysAgo, 20),
      createdAt: ago(session.daysAgo),
      updatedAt: ago(session.daysAgo, 20),
    })),
  );

  await tx.insert(schema.mistakeRecords).values([
    ...SESSIONS.map((session, index) => ({
      id: `qa-mistake-edge-${index}`,
      userId,
      problemId: session.problemId,
      primaryCategory: "edge_case" as const,
      summary: ["Returned the same index twice for [3,3].", "Missed the single-element array.", "Evicted before checking capacity 1."][index]!,
      nextStep: "Write the smallest and duplicate inputs down before coding.",
      sourceType: "practice_session" as const,
      practiceSessionId: session.id,
      status: "confirmed" as const,
      origin: "user" as const,
      requestId: `qa-suggestion-mistake-${index}`,
      confirmedAt: ago(session.daysAgo, 30),
      createdAt: ago(session.daysAgo, 30),
      updatedAt: ago(session.daysAgo, 30),
    })),
    {
      id: "qa-mistake-implementation",
      userId,
      problemId: "qa-problem-two-sum",
      primaryCategory: "implementation" as const,
      summary: "Inserted the value before looking up its complement.",
      nextStep: null,
      sourceType: "practice_session" as const,
      practiceSessionId: "qa-session-two-sum",
      status: "confirmed" as const,
      origin: "user" as const,
      requestId: "qa-suggestion-mistake-implementation",
      confirmedAt: ago(8, 31),
      createdAt: ago(8, 31),
      updatedAt: ago(8, 31),
    },
  ]);

  await tx.insert(schema.suggestionCandidates).values(
    CANDIDATES.map((candidate) => ({
      id: `qa-candidate-${candidate.slug}`,
      userId,
      ...candidate,
      source: "similar_question" as const,
      verifiedAt: ago(1),
      createdAt: ago(1),
      updatedAt: ago(1),
    })),
  );

  await tx.insert(schema.attemptHistory).values({
    id: "qa-attempt-first-bad-version",
    userId,
    slug: "first-bad-version",
    status: "accepted",
    source: "leetcode_status",
    sourceAccount: "qa_leetcode_user",
    observedAt: ago(30),
    createdAt: ago(30),
    updatedAt: ago(30),
  });
}
