import { questionOverlap } from "./practice";

/**
 * Weaknesses (docs/coach-practice.md, version 2): the specific mistakes a user
 * makes on a problem, each in one category, so the Coach can see which kinds
 * of mistakes recur across problems.
 */

export type WeaknessCategoryInfo = {
  key: string;
  name: { en: string; zh: string };
  /** For the Coach: what belongs here, so it files mistakes consistently. */
  description: string;
};

/** Built-in categories. Keys are stable; users can add their own. */
export const WEAKNESS_CATEGORIES: readonly WeaknessCategoryInfo[] = [
  { key: "approach_choice", name: { en: "Picking the approach", zh: "选错方法" }, description: "Chose a technique that can't work, e.g. greedy where DP is needed, or BFS where the problem needs DP." },
  { key: "efficiency", name: { en: "Efficiency", zh: "效率" }, description: "Right idea but too slow (TLE/MLE): repeated work, missing memoization or pruning, an extra loop." },
  { key: "state_definition", name: { en: "Defining the state", zh: "状态定义" }, description: "What dp[i], a pointer, or a recursive call means is wrong or vague." },
  { key: "transition_order", name: { en: "Transitions and loop order", zh: "转移与循环顺序" }, description: "Wrong recurrence or update, or loops/updates in an order that reads stale values." },
  { key: "init_sentinel", name: { en: "Initial values and sentinels", zh: "初始值与哨兵" }, description: "Wrong starting values, base cases, or sentinel (Infinity vs amount + 1, 0 vs -1)." },
  { key: "boundary_index", name: { en: "Indices and off-by-one", zh: "下标与边界" }, description: "Loop bounds, inclusive/exclusive ranges, index arithmetic, off-by-one." },
  { key: "edge_cases", name: { en: "Special inputs", zh: "特殊输入" }, description: "Empty, single element, duplicates, negatives, all-equal, or other inputs the main logic misses." },
  { key: "complexity", name: { en: "Judging complexity", zh: "复杂度判断" }, description: "Misjudged the time or space complexity when explaining a solution." },
  { key: "data_structure", name: { en: "Data structures", zh: "数据结构" }, description: "Picked the wrong structure or misused one (heap order, map vs set, stack vs queue)." },
  { key: "invariant", name: { en: "Invariants and correctness", zh: "不变量与正确性" }, description: "Can't state or keep the invariant that makes the solution correct." },
  { key: "overflow_precision", name: { en: "Overflow and precision", zh: "溢出与精度" }, description: "Integer overflow, float precision, or mixing number types." },
  { key: "implementation_slip", name: { en: "Implementation slips", zh: "实现手误" }, description: "Right plan, wrong code: typos, wrong variable, a missed return, a copy-paste error." },
  { key: "problem_reading", name: { en: "Misreading the problem", zh: "读题偏差" }, description: "Solved a different problem than asked: missed a constraint or the required output." },
];

export const WEAKNESS_CATEGORY_KEY = /^[a-z][a-z0-9_]{2,39}$/;
export const WEAKNESS_DETAIL_MAX = 300;
export const WEAKNESS_EVIDENCE_MAX = 10;
/** Correct answers in later practice sessions that resolve a weakness. */
export const WEAKNESS_RESOLVE_STREAK = 2;
/** A new weakness this close to an active one on the same problem is the same weakness. */
export const WEAKNESS_DUPLICATE_OVERLAP = 0.5;

export function isBuiltinWeaknessCategory(key: string): boolean {
  return WEAKNESS_CATEGORIES.some((category) => category.key === key);
}

export function builtinWeaknessCategoryName(key: string, language: "en" | "zh"): string | null {
  return WEAKNESS_CATEGORIES.find((category) => category.key === key)?.name[language] ?? null;
}

/** The active weakness a new finding repeats: same category and a similar detail. */
export function findDuplicateWeakness<T extends { category: string; detail: string }>(
  active: T[],
  category: string,
  detail: string,
): T | null {
  return (
    active.find(
      (weakness) =>
        weakness.category === category && questionOverlap(weakness.detail, detail) >= WEAKNESS_DUPLICATE_OVERLAP,
    ) ?? null
  );
}

export type WeaknessLike = {
  problemId: string;
  category: string;
  status: "active" | "resolved" | "dismissed";
  hitCount: number;
  lastSeenAt: Date;
  resolvedAt: Date | null;
};

export type WeaknessProfileEntry = {
  category: string;
  active: number;
  resolved: number;
  hits: number;
  problemIds: string[];
  /** Active weaknesses last seen in the trend window. */
  recent: number;
  /** Weaknesses resolved in the trend window. */
  recentlyResolved: number;
};

/** Categories ranked by active weaknesses, then total hits. Dismissed
 *  weaknesses are the user saying "that's wrong" and never count. */
export function computeWeaknessProfile(
  weaknesses: WeaknessLike[],
  now = new Date(),
  trendDays = 30,
): WeaknessProfileEntry[] {
  const since = now.getTime() - trendDays * 24 * 60 * 60 * 1000;
  const byCategory = new Map<string, WeaknessProfileEntry & { problems: Set<string> }>();
  for (const weakness of weaknesses) {
    if (weakness.status === "dismissed") continue;
    const entry =
      byCategory.get(weakness.category) ??
      { category: weakness.category, active: 0, resolved: 0, hits: 0, problemIds: [], recent: 0, recentlyResolved: 0, problems: new Set<string>() };
    entry.hits += weakness.hitCount;
    entry.problems.add(weakness.problemId);
    if (weakness.status === "active") {
      entry.active += 1;
      if (weakness.lastSeenAt.getTime() >= since) entry.recent += 1;
    } else {
      entry.resolved += 1;
      if (weakness.resolvedAt && weakness.resolvedAt.getTime() >= since) entry.recentlyResolved += 1;
    }
    byCategory.set(weakness.category, entry);
  }
  return [...byCategory.values()]
    .map(({ problems, ...entry }) => ({ ...entry, problemIds: [...problems] }))
    .sort((a, b) => b.active - a.active || b.hits - a.hits || a.category.localeCompare(b.category));
}
