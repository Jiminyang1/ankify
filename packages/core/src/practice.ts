import type { DocCard, SolutionApproach } from "./problem-docs";
import { normalizeCardPrompt } from "./problem-docs";
import type { TalkGrade, TalkReference } from "./practice-talk";
import type { FsrsRating } from "./types";

/**
 * The rules of a practice session (docs/coach-practice.md). Code decides
 * what a session contains and what counts as a valid question; the model only
 * writes the questions.
 */

export const PRACTICE_RECALL_MAX = 3;
export const PRACTICE_CHECK_COUNT = 3;
export const PRACTICE_MIN_SCOPES = 3;

export type CardStatLike = {
  lastShownAt: string;
  lastResult: "got_it" | "missed";
  missCount: number;
};

/** Cards for one session: missed last time, then never shown, then the
 *  least recently shown. Ties keep the doc's order. */
export function selectPracticeCards(
  cards: DocCard[],
  stats: Record<string, CardStatLike | undefined>,
  max = PRACTICE_RECALL_MAX,
): DocCard[] {
  const ranked = cards.map((card, index) => {
    const stat = stats[card.key];
    const tier = !stat ? 1 : stat.lastResult === "missed" ? 0 : 2;
    const shownAt = stat ? Date.parse(stat.lastShownAt) || 0 : 0;
    return { card, index, tier, shownAt };
  });
  ranked.sort((a, b) => a.tier - b.tier || a.shownAt - b.shownAt || a.index - b.index);
  return ranked.slice(0, max).map((entry) => entry.card);
}

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

/** A card or question about time/space cost covers the complexity rule. */
export function isComplexityPrompt(text: string): boolean {
  return /complexit|\bbig[- ]?o\b|\bo\([^)]*\)|time and space|space and time|时间复杂度|空间复杂度|复杂度/i.test(text);
}

function tokens(text: string): Set<string> {
  return new Set(
    normalizeCardPrompt(text)
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );
}

/** Rough overlap between two questions, 0 to 1 (Jaccard over words). */
export function questionOverlap(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / (left.size + right.size - shared);
}

export const QUESTION_OVERLAP_LIMIT = 0.6;

export type CheckDraftItem = {
  question: string;
  choices: string[];
  correctAnswer: string;
  scope: string;
  sourceKind: "statement" | "notes" | "card" | "submission";
  sourceRef: string;
};

export type CheckRules = {
  notesSections: string[];
  /** Notes has text but no ## sections: an empty ref cites the whole doc. */
  notesWithoutSections?: boolean;
  cardKeys: string[];
  submissionIds: string[];
  /** Prompts of the cards shown in this session. */
  selectedCardPrompts: string[];
  /** Questions from recent practice sessions and quizzes. */
  recentQuestions: string[];
  /** The user has a failed submission recently: one question must review it. */
  requireMistakeReview: boolean;
};

export type CheckViolation =
  | { rule: "count"; expected: number }
  | { rule: "correct_answer_not_a_choice"; item: number }
  | { rule: "duplicate_choices"; item: number }
  | { rule: "citation"; item: number }
  | { rule: "scopes"; minimum: number }
  | { rule: "complexity" }
  | { rule: "mistake_review" }
  | { rule: "restates_card"; item: number }
  | { rule: "repeats_recent"; item: number }
  | { rule: "repeats_in_batch"; item: number };

/** Every rule a generated batch must pass. Empty means valid. */
export function validateCheckItems(items: CheckDraftItem[], rules: CheckRules): CheckViolation[] {
  const violations: CheckViolation[] = [];
  if (items.length !== PRACTICE_CHECK_COUNT) violations.push({ rule: "count", expected: PRACTICE_CHECK_COUNT });

  const sections = new Set(rules.notesSections.map((section) => section.toLowerCase()));
  const cardKeys = new Set(rules.cardKeys);
  const submissionIds = new Set(rules.submissionIds);

  items.forEach((item, index) => {
    const choices = item.choices.map((choice) => choice.trim());
    if (!choices.includes(item.correctAnswer.trim())) violations.push({ rule: "correct_answer_not_a_choice", item: index });
    if (new Set(choices.map((choice) => choice.toLowerCase())).size !== choices.length) {
      violations.push({ rule: "duplicate_choices", item: index });
    }

    const ref = item.sourceRef.trim();
    const cited =
      item.sourceKind === "statement" ||
      (item.sourceKind === "notes" && (sections.has(ref.toLowerCase()) || (rules.notesWithoutSections === true && ref === ""))) ||
      (item.sourceKind === "card" && cardKeys.has(ref)) ||
      (item.sourceKind === "submission" && submissionIds.has(ref));
    if (!cited) violations.push({ rule: "citation", item: index });

    if (rules.selectedCardPrompts.some((prompt) => questionOverlap(item.question, prompt) >= QUESTION_OVERLAP_LIMIT)) {
      violations.push({ rule: "restates_card", item: index });
    }
    if (rules.recentQuestions.some((question) => questionOverlap(item.question, question) >= QUESTION_OVERLAP_LIMIT)) {
      violations.push({ rule: "repeats_recent", item: index });
    }
    if (items.slice(0, index).some((other) => questionOverlap(item.question, other.question) >= QUESTION_OVERLAP_LIMIT)) {
      violations.push({ rule: "repeats_in_batch", item: index });
    }
  });

  if (new Set(items.map((item) => item.scope)).size < Math.min(PRACTICE_MIN_SCOPES, items.length)) {
    violations.push({ rule: "scopes", minimum: PRACTICE_MIN_SCOPES });
  }
  const complexityCovered =
    items.some((item) => item.scope === "complexity") || rules.selectedCardPrompts.some(isComplexityPrompt);
  if (!complexityCovered) violations.push({ rule: "complexity" });
  if (
    rules.requireMistakeReview &&
    !items.some((item) => item.scope === "mistake_review" && item.sourceKind === "submission")
  ) {
    violations.push({ rule: "mistake_review" });
  }
  return violations;
}
