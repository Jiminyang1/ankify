import { STUDY_PLAN_DATA } from "./study-plans.generated";
import type { LeetCodeDifficulty } from "./types";

/**
 * Study plans drive the profile roadmap: each group is one pattern, and its
 * questions are that pattern's denominator.
 *
 * - Official plans are LeetCode's own study plans, snapshotted by
 *   `pnpm plans:sync`, so nothing here calls LeetCode.
 * - Imported plans come from a user's public LeetCode problem list, grouped
 *   by pattern with `groupByPattern()`.
 */

export interface StudyPlanQuestion {
  id: number;
  slug: string;
  title: string;
  difficulty: LeetCodeDifficulty;
}

export interface StudyPlanGroup {
  name: string;
  questions: StudyPlanQuestion[];
}

export interface StudyPlan {
  slug: string;
  name: string;
  groups: StudyPlanGroup[];
}

export const DEFAULT_STUDY_PLAN = "top-interview-150";

/** LeetCode lists Top 100 Liked's groups alphabetically; a roadmap needs a
 *  learning order. Groups missing here keep their place at the end. */
const GROUP_ORDER: Record<string, readonly string[]> = {
  "top-100-liked": [
    "Hashing",
    "Two Pointers",
    "Sliding Window",
    "Stack",
    "Binary Search",
    "Linked Lists",
    "Matrix",
    "Binary Tree",
    "Trie",
    "Heap",
    "Backtracking",
    "Graph",
    "Greedy",
    "Dynamic Programming",
    "Misc",
  ],
};

function inLearningOrder(plan: StudyPlan): StudyPlan {
  const order = GROUP_ORDER[plan.slug];
  if (!order) return plan;
  const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
  return { ...plan, groups: [...plan.groups].sort((a, b) => rank(a.name) - rank(b.name)) };
}

export const OFFICIAL_STUDY_PLANS: readonly StudyPlan[] = STUDY_PLAN_DATA.map(inLearningOrder);

export function findOfficialStudyPlan(slug: unknown): StudyPlan | null {
  return OFFICIAL_STUDY_PLANS.find((plan) => plan.slug === slug) ?? null;
}

/** Official topic plans and the group names they go deeper on, across every
 *  plan's naming ("1D DP", "DP - 1D", "Graphs - BFS", "Graph General"). */
const DEEP_DIVES: readonly { plan: string; match: RegExp }[] = [
  { plan: "dynamic-programming", match: /\bdp\b|dynamic programming/i },
  { plan: "graph-theory", match: /\bgraphs?\b/i },
  // "Binary Search Tree" is a tree pattern, not a search one.
  { plan: "binary-search", match: /binary search(?!\s*tree)/i },
];

/** The official topic plan that goes deeper on a roadmap group, or null when
 *  there isn't one or the user is already in it. */
export function deepDivePlanFor(groupName: string, currentPlan: string): StudyPlan | null {
  const dive = DEEP_DIVES.find((entry) => entry.match.test(groupName));
  if (!dive || dive.plan === currentPlan) return null;
  return findOfficialStudyPlan(dive.plan);
}

/**
 * Two questions per problem, four answers:
 * - did you solve it? (LeetCode) → `todo` or `solved`
 * - if it's in your ankify reviews, is it due? → `remembered` or `due`
 *
 * `solved` means solved on LeetCode (or archived in ankify) but not being
 * reviewed. FSRS's finer states stay internal; users see only these four.
 */
export type PlanProblemStatus = "todo" | "solved" | "remembered" | "due";

export function planProblemStatus(
  input: { tracked?: { due: Date | null; archived: boolean }; solvedOnLeetcode: boolean },
  now = new Date(),
): PlanProblemStatus {
  const { tracked } = input;
  if (tracked && !tracked.archived) {
    return tracked.due == null || tracked.due <= now ? "due" : "remembered";
  }
  return tracked || input.solvedOnLeetcode ? "solved" : "todo";
}

/**
 * Patterns for grouping an imported list, in learning order. Each question
 * goes to the first pattern in `ASSIGN_ORDER` whose tags it carries: specific
 * techniques (Trie, DP, Backtracking) win over the data structures they run
 * on, and Arrays & Hashing is the fallback.
 */
const PATTERNS = [
  { name: "Arrays & Hashing", tags: ["array", "hash-table", "string", "prefix-sum", "counting", "sorting", "matrix", "simulation"] },
  { name: "Two Pointers", tags: ["two-pointers"] },
  { name: "Sliding Window", tags: ["sliding-window"] },
  { name: "Stack", tags: ["stack", "monotonic-stack", "queue", "monotonic-queue"] },
  { name: "Binary Search", tags: ["binary-search"] },
  { name: "Linked List", tags: ["linked-list", "doubly-linked-list"] },
  { name: "Trees", tags: ["tree", "binary-tree", "binary-search-tree"] },
  { name: "Tries", tags: ["trie"] },
  { name: "Heap / Priority Queue", tags: ["heap-priority-queue"] },
  { name: "Backtracking", tags: ["backtracking"] },
  { name: "Graphs", tags: ["graph", "union-find", "topological-sort", "shortest-path", "minimum-spanning-tree"] },
  { name: "Dynamic Programming", tags: ["dynamic-programming", "memoization", "knapsack-problem"] },
  { name: "Greedy", tags: ["greedy"] },
  { name: "Math & Bits", tags: ["math", "bit-manipulation", "geometry", "number-theory", "combinatorics"] },
] as const;

type PatternName = (typeof PATTERNS)[number]["name"] | "Graphs (DFS/BFS)" | "Other";

const ASSIGN_ORDER: readonly PatternName[] = [
  "Tries",
  "Dynamic Programming",
  "Backtracking",
  "Graphs",
  "Heap / Priority Queue",
  "Linked List",
  "Trees",
  "Graphs (DFS/BFS)",
  "Binary Search",
  "Sliding Window",
  "Two Pointers",
  "Stack",
  "Greedy",
  "Math & Bits",
  "Arrays & Hashing",
];

function patternFor(tags: ReadonlySet<string>): string {
  for (const name of ASSIGN_ORDER) {
    // DFS/BFS on a non-tree problem (islands, word ladder) is a graph problem.
    if (name === "Graphs (DFS/BFS)") {
      if (tags.has("depth-first-search") || tags.has("breadth-first-search")) return "Graphs";
      continue;
    }
    const pattern = PATTERNS.find((p) => p.name === name)!;
    if (pattern.tags.some((tag) => tags.has(tag))) return pattern.name;
  }
  return "Other";
}

export function groupByPattern(
  questions: readonly (StudyPlanQuestion & { tagSlugs: readonly string[] })[],
): StudyPlanGroup[] {
  const byPattern = new Map<string, StudyPlanQuestion[]>();
  for (const { tagSlugs, ...question } of questions) {
    const name = patternFor(new Set(tagSlugs));
    byPattern.set(name, [...(byPattern.get(name) ?? []), question]);
  }
  const order = [...PATTERNS.map((pattern) => pattern.name as string), "Other"];
  return order
    .filter((name) => byPattern.has(name))
    .map((name) => ({ name, questions: byPattern.get(name)! }));
}
