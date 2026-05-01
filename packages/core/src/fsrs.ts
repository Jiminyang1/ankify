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


