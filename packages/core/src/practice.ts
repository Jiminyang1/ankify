import type { SolutionApproach } from "./problem-docs";
import { normalizeCardPrompt } from "./problem-docs";
import type { TalkGrade, TalkReference } from "./practice-talk";
import type { FsrsRating } from "./types";

/**
 * The rules of a practice session (docs/coach-practice.md). Code decides
 * what a talk-through asks about and how its grades turn into a suggested
 * rating; the model only phrases the questions.
 */

/** Score (correct / items) to a suggested rating. The user still chooses.
 *  A perfect score suggests Easy only with at least `easyMinItems` items. */
export function suggestPracticeRating(points: number, items: number, easyMinItems = 4): FsrsRating {
  if (items <= 0) return 3;
  const score = points / items;
  if (score < 0.4) return 1;
  if (score < 0.67) return 2;
  if (score < 1) return 3;
  return items >= easyMinItems ? 4 : 3;
}

/* ── Talk-through practice (docs/coach-practice.md, versions 2 and 3) ── */

export const TALK_TARGET_COUNT = 3;
const MAX_PROBLEM_WEAKNESS_TARGETS = 2;

export type TalkTarget = {
  id: string;
  /** core: the approach and its cost (version 3 always asks it first);
   *  weakness: a recorded mistake on this problem; category: a weak category
   *  from other problems (version 2 sessions only). */
  kind: "weakness" | "category" | "core";
  weaknessId?: string;
  category?: string;
  label: string;
  /** What the judge checks the answer against. Missing: the Coach grades
   *  (version 2 sessions, or no Solutions doc). */
  reference?: TalkReference;
};

export const APPROACH_TARGET_ID = "k-approach";

/** What a talk-through asks about, decided by code: how they'd solve it and
 *  what it costs (the thing the problem's review schedules), then up to two
 *  of this problem's active weak spots, most recent first. */
export function selectPracticeTargets(args: {
  problemWeaknesses: { id: string; category: string; detail: string; lastSeenAt: Date }[];
}): TalkTarget[] {
  const weaknesses = [...args.problemWeaknesses]
    .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
    .slice(0, MAX_PROBLEM_WEAKNESS_TARGETS);
  return [
    { id: APPROACH_TARGET_ID, kind: "core" as const, label: "approach" },
    ...weaknesses.map((weakness) => ({
      id: `w-${weakness.id}`,
      kind: "weakness" as const,
      weaknessId: weakness.id,
      category: weakness.category,
      label: weakness.detail,
    })),
  ].slice(0, TALK_TARGET_COUNT);
}

/** Attaches each target's reference: the approach target gets the Solutions
 *  doc's approaches (cost as the last point), a weak spot gets its detail as
 *  the one point. With no approaches the approach target has none. */
export function withTalkReferences(targets: TalkTarget[], approaches: SolutionApproach[]): TalkTarget[] {
  return targets.map((target) => {
    if (target.kind === "core") {
      if (approaches.length === 0) return target;
      return {
        ...target,
        reference: {
          mode: "key_points",
          approaches: approaches.map((approach) => ({
            id: approach.id,
            name: approach.name,
            mine: approach.mine,
            points: [...approach.points, ...(approach.complexity ? [`Complexity: ${approach.complexity}`] : [])].map(
              (text, index) => ({ id: `p${index + 1}`, text }),
            ),
          })),
        },
      };
    }
    if (target.kind === "weakness") {
      return {
        ...target,
        reference: {
          mode: "avoid_mistake",
          approaches: [{ id: "w", name: target.category ?? "", mine: false, points: [{ id: "p1", text: target.label }] }],
        },
      };
    }
    return target;
  });
}

export const GRADE_POINTS = { correct: 1, partial: 0.5, missed: 0 } as const;

/** Talk-through score and suggestion: every target correct suggests Easy.
 *  The approach target caps it: the review schedules "can you come up with
 *  the solution", so a partial one suggests at most Good, a missed one at most
 *  Hard, and Again with any other miss. */
export function scoreTalk(
  grades: { grade: TalkGrade; approach?: boolean }[],
  options: { endedEarly?: boolean } = {},
): { score: number; rating: FsrsRating } {
  const points = grades.reduce((sum, entry) => sum + GRADE_POINTS[entry.grade], 0);
  let rating = suggestPracticeRating(points, grades.length, grades.length);
  const approach = grades.find((entry) => entry.approach);
  if (approach?.grade === "partial") rating = Math.min(rating, 3) as FsrsRating;
  if (approach?.grade === "missed") {
    const otherMiss = grades.some((entry) => !entry.approach && entry.grade === "missed");
    rating = otherMiss ? 1 : (Math.min(rating, 2) as FsrsRating);
  }
  return {
    score: grades.length ? points / grades.length : 0,
    // Ending early skipped part of the check, so it can't suggest Easy.
    rating: options.endedEarly && rating === 4 ? 3 : rating,
  };
}

function tokens(text: string): Set<string> {
  return new Set(
    normalizeCardPrompt(text)
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );
}

/** Rough overlap between two short texts, 0 to 1 (Jaccard over words), for
 *  spotting a near-duplicate weak spot. */
export function questionOverlap(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / (left.size + right.size - shared);
}
