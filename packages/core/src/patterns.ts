import { PATTERN_PROBLEM_DATA, PATTERN_TOPIC_DATA } from "./patterns.generated";
import {
  NEETCODE_SOURCE_URL,
  PLAN_COURSE_SLUG,
  PLAN_COURSE_SOURCE_URL,
  PLAN_ROUTE_SLUG,
  PLAN_ROUTE_SOURCE_URL,
  planCatalogNode,
  planCatalogProblem,
  planListSets,
  planNodeSlugs,
} from "./plan-catalog";
import { deepDivePlanFor, type StudyPlan, type StudyPlanGroup, type StudyPlanQuestion } from "./study-plans";
import type { LeetCodeDifficulty } from "./types";

/**
 * Patterns come from 灵茶山艾府's twelve problem lists (used with his
 * permission), snapshotted by `pnpm patterns:sync`. A pattern is one
 * technique, such as "count subarrays with exactly k", and its problems are a
 * ladder ordered by contest rating. A problem's patterns are its techniques;
 * their ladders give "one more of this technique" when a review is forgotten
 * or a chapter is finished.
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

/* ── "One more of this technique" (docs/product-main-line.md) ── */

type PatternLookup = (slug: string) => { topic: PatternTopic; pattern: Pattern }[];

/** The techniques a problem uses: its patterns, minus "Other" sections. */
export function techniquesForSlug(
  slug: string,
  lookup: PatternLookup = patternsForSlug,
): { topic: PatternTopic; pattern: Pattern }[] {
  return lookup(slug).filter(({ pattern }) => !isMiscPattern(pattern));
}

function ladderRating(pattern: Pattern, slug: string): number | null {
  return pattern.problems.find(([candidate]) => candidate === slug)?.[1] ?? null;
}

/**
 * After a review is forgotten (Again): one easier problem with the same
 * technique. On each technique's ladder it takes the first problem not done
 * (core tier first, as `nextInPattern()` walks it), preferring one rated below
 * this problem when both have contest ratings. A technique with such a
 * lower-rated problem wins over one without; otherwise techniques go in list
 * order.
 */
export function easierInTechnique(
  slug: string,
  done: (slug: string) => boolean,
  lookup: PatternLookup = patternsForSlug,
): { topic: PatternTopic; pattern: Pattern; step: PatternStep } | null {
  let fallback: { topic: PatternTopic; pattern: Pattern; step: PatternStep } | null = null;
  for (const { topic, pattern } of techniquesForSlug(slug, lookup)) {
    const candidates = nextInPattern(pattern, (other) => other === slug || done(other), { limit: Infinity });
    if (candidates.length === 0) continue;
    const own = ladderRating(pattern, slug);
    const lower = own == null ? undefined : candidates.find((step) => step.rating != null && step.rating < own);
    if (lower) return { topic, pattern, step: lower };
    fallback ??= { topic, pattern, step: candidates[0]! };
  }
  return fallback;
}

/**
 * After a chapter is finished ("go deeper"): the technique most common among
 * the chapter's problems, with its next problems not done. Ties go to the
 * technique that shows up first in the chapter; a technique with nothing left
 * gives way to the next one.
 */
export function goDeeperInChapter(
  slugs: readonly string[],
  done: (slug: string) => boolean,
  options: { limit?: number; lookup?: PatternLookup } = {},
): { topic: PatternTopic; pattern: Pattern; steps: PatternStep[] } | null {
  const { limit = 3, lookup = patternsForSlug } = options;
  const counts = new Map<string, { topic: PatternTopic; pattern: Pattern; count: number }>();
  for (const slug of slugs) {
    for (const { topic, pattern } of techniquesForSlug(slug, lookup)) {
      const entry = counts.get(pattern.key) ?? { topic, pattern, count: 0 };
      entry.count += 1;
      counts.set(pattern.key, entry);
    }
  }
  const inChapter = new Set(slugs);
  // Array.prototype.sort is stable, so equal counts keep chapter order.
  for (const { topic, pattern } of [...counts.values()].sort((a, b) => b.count - a.count)) {
    const steps = nextInPattern(pattern, (slug) => inChapter.has(slug) || done(slug), { limit });
    if (steps.length > 0) return { topic, pattern, steps };
  }
  return null;
}

/**
 * After a plan is finished: what to focus on next. The technique the user
 * forgets most is the list (topic) whose deck problems add up the most
 * lapses; its plan is `ling:<topic>`. Without lapses on any catalog problem it
 * falls back to the official plan that goes deeper on the plan chapter with
 * the most lapses (`deepDivePlanFor()`), and otherwise suggests nothing. The
 * plan the user just finished is never suggested.
 */
export function focusPlanAfter(input: {
  currentPlan: string;
  /** Every problem in the deck with its lapses (times forgotten). */
  deck: readonly { slug: string; lapses: number }[];
  /** The finished plan's chapters with the lapses of their problems. */
  chapters: readonly { name: string; lapses: number }[];
  lookup?: PatternLookup;
}):
  | { kind: "topic"; topic: PatternTopic; plan: string; lapses: number }
  | { kind: "official"; plan: string; chapter: string; lapses: number }
  | null {
  const lookup = input.lookup ?? patternsForSlug;
  const byTopic = new Map<string, number>();
  for (const { slug, lapses } of input.deck) {
    if (lapses <= 0) continue;
    const topics = new Set(techniquesForSlug(slug, lookup).map(({ topic }) => topic.key));
    for (const key of topics) byTopic.set(key, (byTopic.get(key) ?? 0) + lapses);
  }
  const ranked = PATTERN_TOPICS.map((topic) => ({ topic, lapses: byTopic.get(topic.key) ?? 0 }))
    .filter((entry) => entry.lapses > 0 && `${PATTERN_PLAN_PREFIX}${entry.topic.key}` !== input.currentPlan)
    .sort((a, b) => b.lapses - a.lapses);
  const top = ranked[0];
  if (top) return { kind: "topic", topic: top.topic, plan: `${PATTERN_PLAN_PREFIX}${top.topic.key}`, lapses: top.lapses };

  const chapters = input.chapters
    .filter((chapter) => chapter.lapses > 0)
    .sort((a, b) => b.lapses - a.lapses);
  for (const chapter of chapters) {
    const dive = deepDivePlanFor(chapter.name, input.currentPlan);
    if (dive) return { kind: "official", plan: dive.slug, chapter: chapter.name, lapses: chapter.lapses };
  }
  return null;
}

/* ── His lists as profile study plans ── */

export const PATTERN_PLAN_PREFIX = "ling:";
export const PATTERN_ROUTE_SLUG = PLAN_ROUTE_SLUG;

/** Who a built-in plan's source link credits. */
export type StudyPlanCredit = "ling" | "neetcode";

export type PatternStudyPlan = StudyPlan & { sourceUrl: string; credit: StudyPlanCredit };

/** A plan's problems: core tier only (advanced and extensions stay in the
 *  Same pattern view), no premium problems. */
function planQuestions(pattern: Pattern): StudyPlanQuestion[] {
  return patternSteps(pattern)
    .filter((step) => step.tier === "core" && !step.premium)
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

/** A map problem as a plan question. leetcode.cn-only problems stay out of
 *  English plans, and only flat plans need a difficulty for them. */
function catalogQuestion(slug: string, language: "en" | "zh"): StudyPlanQuestion | null {
  const problem = planCatalogProblem(slug);
  if (!problem) throw new Error(`Plan catalog: unknown problem ${slug}`);
  if (problem.cnOnly && language === "en") return null;
  return {
    id: problem.id,
    slug,
    title: language === "zh" ? problem.zh : problem.en || problem.zh,
    difficulty: problem.difficulty ?? "Medium",
    zh: problem.zh,
    ...(problem.cnOnly ? { cnOnly: true, label: problem.label } : {}),
  };
}

function catalogQuestions(slugs: readonly string[], language: "en" | "zh"): StudyPlanQuestion[] {
  return slugs
    .map((slug) => catalogQuestion(slug, language))
    .filter((question): question is StudyPlanQuestion => question !== null);
}

function requireNode(id: string) {
  const node = planCatalogNode(id);
  if (!node) throw new Error(`Plan catalog: no node ${id}`);
  return node;
}

/** The Core Route (from 灵茶山艾府's guide): the map's seven steps, each cut from
 *  his lists under its rating cap, with the step's list as its deep dive.
 *  Step 0, LeetCode's intro plan, is only a link on the map. */
function routePlan(language: "en" | "zh"): PatternStudyPlan {
  const steps = requireNode("X").children.filter((step) => step.stepCap != null);
  return {
    slug: PATTERN_ROUTE_SLUG,
    name: language === "zh" ? "灵神 · 核心路线" : "Ling Shen · Core Route",
    sourceUrl: PLAN_ROUTE_SOURCE_URL,
    credit: "ling",
    groups: dedupe(
      steps.map((step, index) => ({
        name: `${index + 1}. ${step.title[language]}`,
        questions: catalogQuestions(planNodeSlugs(step), language),
        ...(step.deepDive ? { deepDive: step.deepDive } : {}),
      })),
    ),
  };
}

/** His video course: one group per lesson, its worked problems then homework. */
function coursePlan(language: "en" | "zh"): PatternStudyPlan {
  return {
    slug: PLAN_COURSE_SLUG,
    name: language === "zh" ? "灵神 · 基础算法精讲" : "Ling Shen · Algorithm Basics",
    sourceUrl: PLAN_COURSE_SOURCE_URL,
    credit: "ling",
    groups: dedupe(
      requireNode("C").children.map((video) => ({
        name: video.title[language],
        questions: catalogQuestions(planNodeSlugs(video), language),
        ...(video.videoUrl ? { videoUrl: video.videoUrl } : {}),
      })),
    ),
  };
}

/** Course, Core Route, and one plan per list, named in the user's language. */
export function patternStudyPlans(language: "en" | "zh"): PatternStudyPlan[] {
  const author = language === "zh" ? "灵神" : "Ling Shen";
  const topics = PATTERN_TOPICS.map(
    (topic): PatternStudyPlan => ({
      slug: `${PATTERN_PLAN_PREFIX}${topic.key}`,
      name: `${author} · ${topic[language]}`,
      sourceUrl: patternSourceUrl(topic),
      credit: "ling",
      groups: dedupe(
        topic.patterns.map((pattern) => ({
          name: language === "zh" ? zhGroupName(pattern, topic) : pattern.en,
          questions: planQuestions(pattern),
        })),
      ),
    }),
  );
  return [coursePlan(language), routePlan(language), ...topics];
}

/** NeetCode 150 and 250 in his 18 categories. 150 is the problems tagged so in
 *  the same categories. Deep dives are matched on the English category name, so
 *  a Chinese plan gets them too. */
export function neetcodeStudyPlans(language: "en" | "zh"): PatternStudyPlan[] {
  const plan = (slug: string, name: string, keep: (slug: string) => boolean): PatternStudyPlan => ({
    slug,
    name,
    sourceUrl: NEETCODE_SOURCE_URL,
    credit: "neetcode",
    groups: dedupe(
      requireNode("N").children.map((group) => {
        const deepDive = deepDivePlanFor(group.title.en, slug)?.slug;
        return {
          name: group.title[language],
          questions: catalogQuestions(group.problems.filter(keep), language),
          ...(deepDive ? { deepDive } : {}),
        };
      }),
    ),
  });
  const nc150 = new Set(planListSets().nc150);
  return [
    plan("neetcode-150", "NeetCode 150", (slug) => nc150.has(slug)),
    plan("neetcode-250", "NeetCode 250", () => true),
  ];
}
