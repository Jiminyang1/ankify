import type { PatternRefDto, PatternStepDto, ProblemPatternsDto } from "@ankify/contracts";
import {
  isMiscPattern,
  patternSourceUrl,
  patternSteps,
  patternsForSlug,
  type Pattern,
  type PatternStep,
  type PatternTopic,
} from "@ankify/core/patterns";
import { getDb, schema } from "@ankify/db";
import { eq } from "drizzle-orm";
import { getLeetcodeSolved } from "./leetcode-account";

/**
 * Patterns from 灵茶山艾府's problem lists (see `@ankify/core/patterns`):
 * which techniques a problem uses, and what to try next in each.
 */

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
 *  for problems not in the deck. */
export async function loadProblemPatterns(userId: string, slug: string): Promise<ProblemPatternsDto> {
  const found = patternsForSlug(slug);
  if (found.length === 0) return { slug, patterns: [] };
  const done = await loadDone(userId);
  return {
    slug,
    patterns: found.map(({ topic, pattern }) => {
      const steps = patternSteps(pattern).map((step) => toStep(step, done));
      return {
        ...toRef(topic, pattern),
        done: steps.filter((step) => step.done).length,
        total: steps.length,
        misc: isMiscPattern(pattern),
        steps,
      };
    }),
  };
}
