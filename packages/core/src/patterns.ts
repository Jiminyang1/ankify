import { PATTERN_PROBLEM_DATA, PATTERN_TOPIC_DATA } from "./patterns.generated";
import type { StudyPlan, StudyPlanGroup, StudyPlanQuestion } from "./study-plans";
import type { LeetCodeDifficulty } from "./types";

/**
 * Patterns come from 灵茶山艾府's twelve problem lists (used with his
 * permission), snapshotted by `pnpm patterns:sync`. A pattern is one
 * technique, such as "count subarrays with exactly k", and its problems are a
 * ladder ordered by contest rating. Review uses them to suggest a new problem
 * that needs the same technique once one is remembered.
 *
 * The data is large (~600 KB), so this module has its own entry point
 * (`@ankify/core/patterns`) and only server code imports it.
 */

/** core = the section's main problems; advanced = 进阶/选做;
 *  extension = 思维扩展, a stretch beyond the pattern. */
export type PatternTier = "core" | "advanced" | "extension";

/** [leetcode.com slug, contest rating or null, tier] */
export type PatternLadderEntry = readonly [slug: string, rating: number | null, tier: PatternTier];

export interface Pattern {
  /** Stable `<topic>/<pattern>` key, e.g. `sliding-window/window-count-exact`. */
  key: string;
  /** His heading path, e.g. `不定长滑动窗口 / 求子数组个数 / 恰好型滑动窗口`. */
  zh: string;
  en: string;
  problems: readonly PatternLadderEntry[];
}

export interface PatternTopic {
  key: string;
  /** The leetcode.cn discussion id of his list. */
  source: string;
  zh: string;
  en: string;
  patterns: readonly Pattern[];
}

export interface PatternProblem {
  id: number;
  title: string;
  difficulty: LeetCodeDifficulty;
  premium: boolean;
}

export interface PatternStep {
  slug: string;
  id: number;
  title: string;
  difficulty: LeetCodeDifficulty;
  premium: boolean;
  rating: number | null;
  tier: PatternTier;
}

export const PATTERN_TOPICS: readonly PatternTopic[] = PATTERN_TOPIC_DATA;
export const PATTERN_AUTHOR = { zh: "灵茶山艾府", en: "EndlessCheng (灵茶山艾府)" } as const;

export function patternSourceUrl(topic: Pick<PatternTopic, "source">): string {
  return `https://leetcode.cn/circle/discuss/${topic.source}/`;
}

let bySlug: Map<string, { topic: PatternTopic; pattern: Pattern }[]> | null = null;
let byKey: Map<string, { topic: PatternTopic; pattern: Pattern }> | null = null;

function indexes() {
  if (!bySlug || !byKey) {
    bySlug = new Map();
    byKey = new Map();
    for (const topic of PATTERN_TOPICS) {
      for (const pattern of topic.patterns) {
        byKey.set(pattern.key, { topic, pattern });
        for (const [slug] of pattern.problems) {
          const list = bySlug.get(slug) ?? [];
          list.push({ topic, pattern });
          bySlug.set(slug, list);
        }
      }
    }
  }
  return { bySlug, byKey };
}

/** Every pattern a problem belongs to, in list order. */
export function patternsForSlug(slug: string): { topic: PatternTopic; pattern: Pattern }[] {
  return indexes().bySlug.get(slug) ?? [];
}

export function findPattern(key: string): { topic: PatternTopic; pattern: Pattern } | null {
  return indexes().byKey.get(key) ?? null;
}

export function patternProblem(slug: string): PatternProblem | null {
  return PATTERN_PROBLEM_DATA[slug] ?? null;
}

/** "Other …" sections collect leftovers that share no technique, so a
 *  problem there says nothing about what to try next. */
export function isMiscPattern(pattern: Pick<Pattern, "zh">): boolean {
  const last = pattern.zh.split(" / ").at(-1) ?? "";
  return last.startsWith("其他");
}

const TIER_ORDER: Record<PatternTier, number> = { core: 0, advanced: 1, extension: 2 };

export function patternSteps(pattern: Pattern): PatternStep[] {
  return pattern.problems
    .map(([slug, rating, tier]) => {
      const problem = PATTERN_PROBLEM_DATA[slug];
      return problem ? { slug, ...problem, rating, tier } : null;
    })
    .filter((step): step is PatternStep => step !== null);
}

/**
 * The next problems to try in a pattern: core first, then advanced, then
 * extensions, each in the list's own (rating) order, skipping problems the
 * user has done and, unless asked, premium ones.
 */
export function nextInPattern(
  pattern: Pattern,
  done: (slug: string) => boolean,
  options: { limit?: number; includePremium?: boolean } = {},
): PatternStep[] {
  const { limit = 1, includePremium = false } = options;
  return patternSteps(pattern)
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => !done(step.slug) && (includePremium || !step.premium))
    .sort((a, b) => TIER_ORDER[a.step.tier] - TIER_ORDER[b.step.tier] || a.index - b.index)
    .slice(0, limit)
    .map(({ step }) => step);
}

/**
 * After a problem is remembered: one new problem that needs the same
 * technique. Patterns are tried in list order; "Other" sections and muted
 * patterns are skipped.
 */
export function suggestSamePattern(
  slug: string,
  done: (slug: string) => boolean,
  muted: ReadonlySet<string> = new Set(),
): { topic: PatternTopic; pattern: Pattern; next: PatternStep } | null {
  for (const { topic, pattern } of patternsForSlug(slug)) {
    if (isMiscPattern(pattern) || muted.has(pattern.key)) continue;
    const [next] = nextInPattern(pattern, (other) => other === slug || done(other));
    if (next) return { topic, pattern, next };
  }
  return null;
}

/* ── His lists as profile study plans ── */

export const PATTERN_PLAN_PREFIX = "ling:";
export const PATTERN_ROUTE_SLUG = "ling:route";
/** His "如何科学刷题" guide, where the Beginner Route comes from. */
const ROUTE_SOURCE = "RvFUtj";

/**
 * The Beginner Route (新手村) from his guide: seven stages across the lists,
 * each kept to the problems at or below a rating (unrated problems, which
 * never appeared in a contest, stay in). DP goes to 2000 because few DP
 * problems rate lower. Stage 0, LeetCode's own intro list, is leetcode.cn
 * only and left out.
 */
const ROUTE: readonly { topic: string; en: string; zh: string; patterns: readonly string[]; maxRating: number }[] = [
  {
    topic: "sliding-window",
    en: "Sliding window",
    zh: "滑动窗口",
    patterns: ["fixed-window", "window-longest", "window-shortest", "window-count-at-most", "window-count-at-least", "window-count-exact"],
    maxRating: 1700,
  },
  { topic: "binary-search", en: "Binary search", zh: "二分查找", patterns: ["lower-bound"], maxRating: 1700 },
  {
    topic: "data-structures",
    en: "Prefix sums, stacks, queues, heaps",
    zh: "前缀和、栈、队列、堆",
    patterns: ["enumerate-right", "prefix-sum", "prefix-sum-hash", "stack", "queue", "heap"],
    maxRating: 1700,
  },
  {
    topic: "trees",
    en: "Binary tree DFS",
    zh: "二叉树 DFS",
    patterns: ["tree-traversal", "tree-top-down", "tree-bottom-up", "tree-both-ways", "tree-lca", "bst"],
    maxRating: 1700,
  },
  { topic: "grid", en: "Grid DFS", zh: "网格图 DFS", patterns: ["dfs"], maxRating: 1700 },
  {
    topic: "trees",
    en: "Backtracking",
    zh: "回溯",
    patterns: ["subsets", "partitions", "combinations", "permutations"],
    maxRating: 1700,
  },
  {
    topic: "dp",
    en: "Dynamic programming",
    zh: "动态规划",
    patterns: [
      "climbing-stairs",
      "house-robber",
      "max-subarray",
      "grid",
      "knapsack-01",
      "knapsack-unbounded",
      "lcs",
      "lis",
      "stocks",
    ],
    maxRating: 2000,
  },
];

export type PatternStudyPlan = StudyPlan & { sourceUrl: string };

/** A plan's problems: core tier only (advanced and extensions stay in the
 *  Same pattern view), no premium problems. */
function planQuestions(pattern: Pattern, maxRating = Infinity): StudyPlanQuestion[] {
  return patternSteps(pattern)
    .filter((step) => step.tier === "core" && !step.premium && (step.rating ?? 0) <= maxRating)
    .map((step) => ({ id: step.id, slug: step.slug, title: step.title, difficulty: step.difficulty }));
}

/** Drop problems an earlier group already has, then groups left empty. */
function dedupe(groups: StudyPlanGroup[]): StudyPlanGroup[] {
  const seen = new Set<string>();
  return groups
    .map((group) => ({
      ...group,
      questions: group.questions.filter((question) => !seen.has(question.slug) && seen.add(question.slug)),
    }))
    .filter((group) => group.questions.length > 0);
}

/** A pattern's group name in Chinese: his heading, with its parent kept when
 *  the short name repeats in the list (其他, 有递有归 under two kinds of tree). */
function zhGroupName(pattern: Pattern, topic: PatternTopic): string {
  const short = (zh: string) => zh.split(" / ").at(-1)!;
  const parts = pattern.zh.split(" / ");
  const repeated = topic.patterns.filter((other) => short(other.zh) === short(pattern.zh)).length > 1;
  return repeated && parts.length > 1 ? `${parts.at(-2)} · ${parts.at(-1)}` : parts.at(-1)!;
}

/** The Beginner Route and one plan per list, named in the user's language. */
export function patternStudyPlans(language: "en" | "zh"): PatternStudyPlan[] {
  const author = language === "zh" ? "灵神" : "Ling Shen";
  const route: PatternStudyPlan = {
    slug: PATTERN_ROUTE_SLUG,
    name: language === "zh" ? `${author} · 新手村路线` : `${author} · Beginner Route`,
    sourceUrl: patternSourceUrl({ source: ROUTE_SOURCE }),
    groups: dedupe(
      ROUTE.map((stage, index) => ({
        name: `${index + 1}. ${stage[language]}`,
        questions: stage.patterns.flatMap((key) => {
          const found = findPattern(`${stage.topic}/${key}`);
          if (!found) throw new Error(`Beginner Route: unknown pattern ${stage.topic}/${key}`);
          return planQuestions(found.pattern, stage.maxRating);
        }),
        deepDive: `${PATTERN_PLAN_PREFIX}${stage.topic}`,
      })),
    ),
  };
  const topics = PATTERN_TOPICS.map(
    (topic): PatternStudyPlan => ({
      slug: `${PATTERN_PLAN_PREFIX}${topic.key}`,
      name: `${author} · ${topic[language]}`,
      sourceUrl: patternSourceUrl(topic),
      groups: dedupe(
        topic.patterns.map((pattern) => ({
          name: language === "zh" ? zhGroupName(pattern, topic) : pattern.en,
          questions: planQuestions(pattern),
        })),
      ),
    }),
  );
  return [route, ...topics];
}
