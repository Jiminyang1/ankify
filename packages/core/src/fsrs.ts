import {
  fsrs,
  generatorParameters,
  createEmptyCard,
  State,
  type Card as FsrsCard,
  type Grade,
} from "ts-fsrs";
import type { FsrsRating } from "./types";

export interface FsrsCardState {
  due: Date | null;
  stability: number | null;
  difficulty: number | null;
  elapsedDays: number | null;
  scheduledDays: number | null;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: "new" | "learning" | "review" | "relearning";
  lastReview: Date | null;
}

const STATE_TO_STR: Record<State, FsrsCardState["state"]> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

const STR_TO_STATE: Record<FsrsCardState["state"], State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

/** Scheduling provenance recorded on review events written after migration 0021. */
export const SCHEDULING_POLICIES = {
  /** The legacy review route: default FSRS with short-term learning steps. */
  legacySelfRecall: "legacy_self_recall_v1",
  /** Completing initial learning: the first review a fixed delay later, no rating. */
  initialDelay: "initial_delay_v1",
  /** A rated review after solving the problem again on LeetCode. */
  leetcodeFullSolve: "leetcode_full_solve_v1",
} as const;

/** Delay between completing initial learning and the first review. */
export const INITIAL_REVIEW_DELAY_HOURS = { default: 24, min: 1, max: 168 } as const;

export function clampInitialReviewDelayHours(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return INITIAL_REVIEW_DELAY_HOURS.default;
  return Math.min(INITIAL_REVIEW_DELAY_HOURS.max, Math.max(INITIAL_REVIEW_DELAY_HOURS.min, Math.round(value)));
}

/** When the first review falls due after initial learning completed. The FSRS
 *  state stays `new` with no review recorded: no recall rating is invented. */
export function initialReviewDue(completedAt: Date, delayHours: number) {
  return new Date(completedAt.getTime() + clampInitialReviewDelayHours(delayHours) * 3_600_000);
}

export function defaultScheduler() {
  // 0.9 retention is the FSRS-recommended default for a balance of workload vs forgetting.
  return fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.9 }));
}

export function emptyCardState(now = new Date()): FsrsCardState {
  const c = createEmptyCard(now);
  return toState(c);
}

export function toState(c: FsrsCard): FsrsCardState {
  return {
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: STATE_TO_STR[c.state],
    lastReview: c.last_review ?? null,
  };
}

export function fromState(s: FsrsCardState): FsrsCard {
  return {
    due: s.due ?? new Date(),
    stability: s.stability ?? 0,
    difficulty: s.difficulty ?? 0,
    elapsed_days: s.elapsedDays ?? 0,
    scheduled_days: s.scheduledDays ?? 0,
    learning_steps: s.learningSteps,
    reps: s.reps,
    lapses: s.lapses,
    state: STR_TO_STATE[s.state],
    last_review: s.lastReview ?? undefined,
  };
}

export function rate(state: FsrsCardState, rating: FsrsRating, now = new Date()) {
  const scheduler = defaultScheduler();
  const result = scheduler.next(fromState(state), now, rating as Grade);
  return {
    next: toState(result.card),
    log: result.log,
  };
}

/**
 * `leetcode_full_solve_v1`: the default weights, 90% retention, and fuzz, with
 * short-term learning steps disabled. A full solve is a day-scale event, so
 * every outcome (including from legacy learning or relearning states) is a
 * day-based interval chosen by FSRS itself, never rewritten here.
 */
export function fullSolveScheduler() {
  return fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.9, enable_short_term: false }));
}

/** Rates a completed full-solve review as of when it was completed, so a
 *  rating given later schedules from the actual review time. */
export function rateFullSolve(state: FsrsCardState, rating: FsrsRating, reviewedAt: Date) {
  const result = fullSolveScheduler().next(fromState(state), reviewedAt, rating as Grade);
  return { next: toState(result.card), log: result.log };
}

/** All four full-solve outcomes as of `reviewedAt`, for rating buttons. */
export function previewFullSolve(state: FsrsCardState, reviewedAt: Date) {
  const record = fullSolveScheduler().repeat(fromState(state), reviewedAt);
  return {
    1: { due: record[1].card.due.toISOString() },
    2: { due: record[2].card.due.toISOString() },
    3: { due: record[3].card.due.toISOString() },
    4: { due: record[4].card.due.toISOString() },
  } as const;
}

/** Retrievability for display: `null` for a problem never reviewed, whose
 *  recall is not yet estimated (not proven perfect). */
export function retrievabilityEstimate(state: FsrsCardState, at = new Date()): number | null {
  return state.state === "new" ? null : retrievability(state, at);
}

/** Compute all four rating outcomes at once — use for previews. */
export function preview(state: FsrsCardState, now = new Date()) {
  const scheduler = defaultScheduler();
  const record = scheduler.repeat(fromState(state), now);
  return {
    1: { due: record[1].card.due.toISOString() } as const,
    2: { due: record[2].card.due.toISOString() } as const,
    3: { due: record[3].card.due.toISOString() } as const,
    4: { due: record[4].card.due.toISOString() } as const,
  };
}

export function retrievability(state: FsrsCardState, at = new Date()) {
  const scheduler = defaultScheduler();
  if (state.state === "new") return 1;
  return scheduler.get_retrievability(fromState(state), at, false) as number;
}

