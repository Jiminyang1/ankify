import type { DocCard } from "./problem-docs";
import { normalizeCardPrompt } from "./problem-docs";
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

/* ── Talk-through practice (docs/coach-practice.md, version 2) ── */

export const TALK_TARGET_COUNT = 3;
const MAX_PROBLEM_WEAKNESS_TARGETS = 2;
const MAX_CATEGORY_TARGETS = 1;
const CORE_TARGETS = ["approach", "complexity"] as const;

export type TalkTarget = {
  id: string;
  kind: "weakness" | "category" | "core";
  weaknessId?: string;
  category?: string;
  label: string;
};

/** What a talk-through session asks about, decided by code: this problem's
 *  active weak spots (most recent first), then the user's weakest category
 *  from other problems, then approach and complexity. */
export function selectPracticeTargets(args: {
  problemWeaknesses: { id: string; category: string; detail: string; lastSeenAt: Date }[];
  /** Categories with active weak spots, weakest first (from the profile). */
  weakCategories: string[];
}): TalkTarget[] {
  const targets: TalkTarget[] = [];
  const weaknesses = [...args.problemWeaknesses]
    .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
    .slice(0, MAX_PROBLEM_WEAKNESS_TARGETS);
  for (const weakness of weaknesses) {
    targets.push({ id: `w-${weakness.id}`, kind: "weakness", weaknessId: weakness.id, category: weakness.category, label: weakness.detail });
  }
  const covered = new Set(targets.map((target) => target.category));
  for (const category of args.weakCategories) {
    if (targets.length >= TALK_TARGET_COUNT || targets.filter((t) => t.kind === "category").length >= MAX_CATEGORY_TARGETS) break;
    if (covered.has(category)) continue;
    targets.push({ id: `c-${category}`, kind: "category", category, label: category });
    covered.add(category);
  }
  for (const core of CORE_TARGETS) {
    if (targets.length >= TALK_TARGET_COUNT) break;
    if (core === "complexity" && covered.has("complexity")) continue;
    targets.push({ id: `k-${core}`, kind: "core", label: core });
  }
  return targets.slice(0, TALK_TARGET_COUNT);
}

export const GRADE_POINTS = { correct: 1, partial: 0.5, missed: 0 } as const;

/** Talk-through score and suggestion: every target correct suggests Easy. */
export function scoreTalk(
  grades: ("correct" | "partial" | "missed")[],
  options: { endedEarly?: boolean } = {},
): { score: number; rating: FsrsRating } {
  const points = grades.reduce((sum, grade) => sum + GRADE_POINTS[grade], 0);
  const rating = suggestPracticeRating(points, grades.length, grades.length);
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
