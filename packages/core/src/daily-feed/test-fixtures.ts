import type { SkillDimension } from "../skills";
import type { DailyFeedInput, FeedEvidence, FeedProblem, FeedQuizMiss } from "./types";

/** Shared builders for the daily-feed tests. Not exported from the package. */

const DAY_MS = 86_400_000;
export const NOW = new Date("2026-09-28T12:00:00.000Z");
export const TODAY = "2026-09-28";

export function daysFrom(base: Date, days: number) {
  return new Date(base.getTime() + days * DAY_MS);
}

export function shiftDateKey(dateKey: string, days: number) {
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function problem(id: string, overrides: Partial<FeedProblem> = {}, now = NOW): FeedProblem {
  return {
    id,
    slug: id,
    title: `Problem ${id}`,
    difficulty: "Medium",
    topics: [],
    due: daysFrom(now, 10),
    lastReview: daysFrom(now, -10),
    retrievability: 0.8,
    lapses: 0,
    archived: false,
    similar: [],
    ...overrides,
  };
}

export function mistake(
  dimension: SkillDimension,
  on: FeedProblem,
  { daysAgo = 0, resolved = false, now = NOW }: { daysAgo?: number; resolved?: boolean; now?: Date } = {},
): FeedEvidence {
  return { kind: "mistake", dimension, resolved, at: daysFrom(now, -daysAgo), problemId: on.id, topics: on.topics };
}

export function quizAnswer(
  scope: string,
  correct: boolean,
  on: FeedProblem,
  { daysAgo = 0, now = NOW }: { daysAgo?: number; now?: Date } = {},
): FeedEvidence {
  return { kind: "quiz_answer", scope, correct, at: daysFrom(now, -daysAgo), problemId: on.id, topics: on.topics };
}

export function quizMiss(
  on: FeedProblem,
  scope: string,
  itemId: string,
  { daysAgo = 5, now = NOW }: { daysAgo?: number; now?: Date } = {},
): FeedQuizMiss {
  return { problemId: on.id, quizSessionId: `session-${on.id}`, quizItemId: itemId, scope, missedAt: daysFrom(now, -daysAgo) };
}

export function feedInput(overrides: Partial<DailyFeedInput> = {}): DailyFeedInput {
  return {
    seed: "user-1",
    dateKey: TODAY,
    now: NOW,
    settings: { dailyItems: 3, includeNewProblems: true },
    evidence: [],
    problems: [],
    quizMisses: [],
    history: [],
    ...overrides,
  };
}
