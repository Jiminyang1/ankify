import type {
  PatternRefDto,
  PatternStepDto,
  PatternSuggestionDto,
  ProblemPatternsDto,
} from "@ankify/contracts";
import {
  findPattern,
  isMiscPattern,
  patternSourceUrl,
  patternSteps,
  patternsForSlug,
  suggestSamePattern,
  type Pattern,
  type PatternStep,
  type PatternTopic,
} from "@ankify/core/patterns";
import { getDb, schema } from "@ankify/db";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { getLeetcodeSolved } from "./leetcode-account";
import { getReviewSettings } from "./settings";
import { getZonedDayBounds } from "./time-zone";

/**
 * Patterns from 灵茶山艾府's problem lists (see `@ankify/core/patterns`):
 * which techniques a problem uses, what to try next in each, and, after a
 * problem is remembered, one new problem with the same technique.
 */

const KEY = "pattern-suggestions";
/** Passive suggestions per review day. Each one the user tries becomes a
 *  review the next day, so this stays well under the daily review limit. */
export const DAILY_SUGGESTIONS = 3;
/** Successful ratings (Good or Easy) a problem needs, this one included,
 *  before it counts as remembered. */
const SUCCESSES_BEFORE_SUGGESTING = 2;

type Stored = {
  muted: string[];
  /** problemId → the suggestion made after it, so each problem suggests once. */
  shown: Record<string, { slug: string; pattern: string; at: number }>;
};

async function readStored(userId: string): Promise<Stored> {
  const [row] = await getDb()
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, KEY)));
  const value = row?.value as Partial<Stored> | undefined;
  return {
    muted: Array.isArray(value?.muted) ? value.muted.filter((key) => typeof key === "string") : [],
    shown: value?.shown && typeof value.shown === "object" ? value.shown : {},
  };
}

async function writeStored(userId: string, value: Stored) {
  await getDb()
    .insert(schema.settings)
    .values({ userId, key: KEY, value })
    .onConflictDoUpdate({
      target: [schema.settings.userId, schema.settings.key],
      set: { value, updatedAt: new Date() },
    });
}

/** Slugs the user has done: everything in the deck (archived too) plus the
 *  extension's LeetCode solved list. Deck slugs map to their problem id. */
async function loadDone(userId: string) {
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

function toRef(topic: PatternTopic, pattern: Pattern): PatternRefDto {
  return {
    key: pattern.key,
    name: { en: pattern.en, zh: pattern.zh.split(" / ").at(-1) ?? pattern.zh },
    topic: { key: topic.key, name: { en: topic.en, zh: topic.zh }, sourceUrl: patternSourceUrl(topic) },
  };
}

function toStep(step: PatternStep, done: Awaited<ReturnType<typeof loadDone>>): PatternStepDto {
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
 *  for problems not in the deck, so the extension can show it on any page. */
export async function loadProblemPatterns(userId: string, slug: string): Promise<ProblemPatternsDto> {
  const found = patternsForSlug(slug);
  if (found.length === 0) return { slug, patterns: [] };
  const [done, stored] = await Promise.all([loadDone(userId), readStored(userId)]);
  const muted = new Set(stored.muted);
  return {
    slug,
    patterns: found.map(({ topic, pattern }) => {
      const steps = patternSteps(pattern).map((step) => toStep(step, done));
      return {
        ...toRef(topic, pattern),
        done: steps.filter((step) => step.done).length,
        total: steps.length,
        misc: isMiscPattern(pattern),
        muted: muted.has(pattern.key),
        steps,
      };
    }),
  };
}

export async function setPatternMuted(userId: string, key: string, muted: boolean): Promise<boolean> {
  if (!findPattern(key)) return false;
  const stored = await readStored(userId);
  const next = new Set(stored.muted);
  if (muted) next.add(key);
  else next.delete(key);
  await writeStored(userId, { ...stored, muted: [...next] });
  return true;
}

/**
 * Called after a rating is saved. Suggests one new problem with the same
 * technique when the problem is remembered: rated Good or Easy, with at
 * least one earlier success. Each problem suggests once, and at most
 * DAILY_SUGGESTIONS a review day.
 */
export async function suggestAfterRating(
  userId: string,
  problemId: string,
  rating: number,
): Promise<PatternSuggestionDto | null> {
  if (rating < 3) return null;
  const db = getDb();
  const [problem] = await db
    .select({ slug: schema.problems.leetcodeSlug })
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)))
    .limit(1);
  if (!problem || patternsForSlug(problem.slug).length === 0) return null;

  const stored = await readStored(userId);
  if (stored.shown[problemId]) return null;

  const [successes] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.reviewEvents)
    .where(
      and(
        eq(schema.reviewEvents.userId, userId),
        eq(schema.reviewEvents.problemId, problemId),
        eq(schema.reviewEvents.eventType, "self_recall_rated"),
        gte(schema.reviewEvents.fsrsRating, 3),
        isNull(schema.reviewEvents.undoneAt),
      ),
    );
  if ((successes?.count ?? 0) < SUCCESSES_BEFORE_SUGGESTING) return null;

  const now = new Date();
  const review = await getReviewSettings(userId);
  const { start } = getZonedDayBounds(review.timeZone, now);
  const shownToday = Object.values(stored.shown).filter((entry) => entry.at >= start.getTime()).length;
  if (shownToday >= DAILY_SUGGESTIONS) return null;

  const done = await loadDone(userId);
  const suggestion = suggestSamePattern(problem.slug, done.isDone, new Set(stored.muted));
  if (!suggestion) return null;

  await writeStored(userId, {
    ...stored,
    shown: {
      ...stored.shown,
      [problemId]: { slug: suggestion.next.slug, pattern: suggestion.pattern.key, at: now.getTime() },
    },
  });
  return {
    pattern: toRef(suggestion.topic, suggestion.pattern),
    problem: toStep(suggestion.next, done),
  };
}
