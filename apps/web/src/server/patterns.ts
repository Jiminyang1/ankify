import type {
  PatternRefDto,
  PatternStepDto,
  ProblemChapterDto,
  ProblemPatternsDto,
  TechniqueSuggestionDto,
} from "@ankify/contracts";
import {
  easierInTechnique,
  isMiscPattern,
  patternSourceUrl,
  patternSteps,
  patternsForSlug,
  techniquesForSlug,
  type Pattern,
  type PatternStep,
  type PatternTopic,
} from "@ankify/core/patterns";
import { getDb, schema } from "@ankify/db";
import { and, eq } from "drizzle-orm";
import { getLeetcodeSolved } from "./leetcode-account";
import { getReviewSettings } from "./settings";
import { getCurrentStudyPlan, studyPlanSourceUrl } from "./study-plans";
import { formatDateKeyInTimeZone } from "./time-zone";

/**
 * Patterns from 灵茶山艾府's problem lists (see `@ankify/core/patterns`):
 * which techniques a problem uses, what to try next in each, and the one
 * easier problem offered when a review is forgotten.
 */

type Language = "en" | "zh";

/** Slugs the user has done: everything in the deck (archived too) plus the
 *  extension's LeetCode solved list. Deck slugs map to their problem id. */
export async function loadDone(userId: string) {
  const [deck, solved] = await Promise.all([
    getDb()
      .select({ id: schema.problems.id, slug: schema.problems.leetcodeSlug })
      .from(schema.problems)
      .where(eq(schema.problems.userId, userId)),
    getLeetcodeSolved(userId),
  ]);
  const inDeck = new Map(deck.map((row) => [row.slug, row.id]));
  const solvedSlugs = new Set(solved?.slugs ?? []);
  return { inDeck, isDone: (slug: string) => inDeck.has(slug) || solvedSlugs.has(slug) };
}

export type DoneSet = { inDeck: ReadonlyMap<string, string>; isDone: (slug: string) => boolean };

export function toPatternRef(topic: PatternTopic, pattern: Pattern): PatternRefDto {
  return {
    key: pattern.key,
    name: { en: pattern.en, zh: pattern.zh.split(" / ").at(-1) ?? pattern.zh },
    topic: { key: topic.key, name: { en: topic.en, zh: topic.zh }, sourceUrl: patternSourceUrl(topic) },
  };
}

export function toPatternStep(step: PatternStep, done: DoneSet): PatternStepDto {
  return {
    slug: step.slug,
    id: step.id,
    title: step.title,
    difficulty: step.difficulty,
    premium: step.premium,
    rating: step.rating,
    tier: step.tier,
    problemId: done.inDeck.get(step.slug) ?? null,
    done: done.isDone(step.slug),
  };
}

/** The patterns a LeetCode problem belongs to, with each one's ladder. Works
 *  for problems not in the deck. */
export async function loadProblemPatterns(userId: string, slug: string): Promise<ProblemPatternsDto> {
  const found = patternsForSlug(slug);
  if (found.length === 0) return { slug, patterns: [] };
  const done = await loadDone(userId);
  return {
    slug,
    patterns: found.map(({ topic, pattern }) => {
      const steps = patternSteps(pattern).map((step) => toPatternStep(step, done));
      return {
        ...toPatternRef(topic, pattern),
        done: steps.filter((step) => step.done).length,
        total: steps.length,
        misc: isMiscPattern(pattern),
        steps,
      };
    }),
  };
}

/** A problem's chapter in the user's current plan and its techniques from
 *  the catalog. Works for problems not in the deck. */
export async function loadProblemChapter(userId: string, slug: string, language: Language): Promise<ProblemChapterDto> {
  const { plan } = await getCurrentStudyPlan(userId, language);
  const group = plan.groups.find((candidate) => candidate.questions.some((question) => question.slug === slug));
  return {
    slug,
    chapter: group
      ? { name: group.name, plan: { slug: plan.slug, name: plan.name, sourceUrl: studyPlanSourceUrl(plan.slug) } }
      : null,
    techniques: techniquesForSlug(slug).map(({ topic, pattern }) => toPatternRef(topic, pattern)),
  };
}

/* ── After a forgotten review ── */

const SHOWN_KEY = "technique-suggestions";

/** problemId → the day (user's time zone) an easier problem was offered. */
type Shown = { forgot: Record<string, string> };

async function readShown(userId: string): Promise<Shown> {
  const [row] = await getDb()
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, SHOWN_KEY)));
  const forgot = (row?.value as Partial<Shown> | undefined)?.forgot;
  return { forgot: forgot && typeof forgot === "object" ? forgot : {} };
}

async function writeShown(userId: string, value: Shown) {
  await getDb()
    .insert(schema.settings)
    .values({ userId, key: SHOWN_KEY, value })
    .onConflictDoUpdate({
      target: [schema.settings.userId, schema.settings.key],
      set: { value, updatedAt: new Date() },
    });
}

/**
 * Called after a review is rated Again: one easier problem with the same
 * technique (`easierInTechnique()`), so the user can rebuild it on a smaller
 * step. Once per problem a day; null outside the catalog or when every
 * problem on its ladders is done.
 */
export async function suggestAfterForgetting(userId: string, problemId: string): Promise<TechniqueSuggestionDto | null> {
  const [problem] = await getDb()
    .select({ slug: schema.problems.leetcodeSlug })
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)))
    .limit(1);
  if (!problem || techniquesForSlug(problem.slug).length === 0) return null;

  const [shown, review] = await Promise.all([readShown(userId), getReviewSettings(userId)]);
  const today = formatDateKeyInTimeZone(new Date(), review.timeZone);
  if (shown.forgot[problemId] === today) return null;

  const done = await loadDone(userId);
  const pick = easierInTechnique(problem.slug, done.isDone);
  if (!pick) return null;

  // Only today's entries matter; older ones are dropped as it's rewritten.
  const forgot = Object.fromEntries(Object.entries(shown.forgot).filter(([, day]) => day === today));
  await writeShown(userId, { forgot: { ...forgot, [problemId]: today } });
  return { technique: toPatternRef(pick.topic, pick.pattern), problem: toPatternStep(pick.step, done) };
}
