import type { QueueStatsDto } from "./dto";
import type { PracticeProblemStatusDto, PracticeSessionDto } from "./practice-sessions";
import type { CaptureProblemInput } from "./schemas";

export type ReviewOverviewProblemDto = {
  id: string;
  leetcodeSlug: string;
  title: string;
  difficulty: CaptureProblemInput["difficulty"];
  url: string;
  fsrsState: "new" | "learning" | "review" | "relearning";
  fsrsDue: string | null;
  /** Whole local days since the problem fell due; 0 when due today or later. */
  overdueDays: number;
  /** The open practice session on this problem, if any. */
  openSessionId: string | null;
};

export type ReviewOverviewSessionDto = {
  session: PracticeSessionDto;
  problem: PracticeProblemStatusDto;
};

/** GET /api/review/overview — the extension popup's daily view. */
export type ReviewOverviewDto = {
  serverNow: string;
  timeZone: string;
  /** Daily-limit stats with the same meaning as the legacy queue. */
  queue: QueueStatsDto;
  /** Due now, most overdue first, up to today's remaining allowance. */
  due: ReviewOverviewProblemDto[];
  /** Scheduled within the next seven days, soonest first. */
  upcoming: ReviewOverviewProblemDto[];
  /** Completed reviews still waiting for their rating. */
  pendingRatings: ReviewOverviewSessionDto[];
  /** Active or interrupted sessions that can be resumed. */
  openSessions: ReviewOverviewSessionDto[];
  counts: {
    /** Every due problem, not capped by the daily limit. */
    dueNow: number;
    /** Fell due before today (local time). */
    overdue: number;
    upcomingWeek: number;
    /** First practice not finished; no review scheduled yet. */
    awaitingInitial: number;
    /** Ratings recorded today (sessions and the legacy route), excluding undone ones. */
    reviewsToday: number;
    /** Initial learning completed today; not a review. */
    initialLearningToday: number;
    /** Practice sessions of any kind completed today. */
    sessionsCompletedToday: number;
  };
};
