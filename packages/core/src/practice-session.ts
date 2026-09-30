/**
 * Pure practice-session rules shared by the server (authoritative, inside
 * transactions) and the extension (to decide what to report). No I/O.
 */

export type PracticeSessionType = "initial_learning" | "scheduled_review" | "voluntary_practice";
export type ReviewIntent = "due" | "early" | "none";
export type PracticeSessionStatus = "active" | "interrupted" | "completed" | "abandoned";
export type PracticeMode = "practice" | "due_review" | "early_review";
export type BaselineState = "pending" | "established" | "none" | "unavailable";
export type RatingDisposition =
  | "not_applicable"
  | "pending"
  | "deferred"
  | "submitted"
  | "dismissed"
  | "expired"
  | "superseded"
  | "undone";

/** A tab owns a session for this long after its last heartbeat. */
export const SESSION_LEASE_MS = 60_000;
/** An open session inactive this long is stale: kept as history, slot released. */
export const SESSION_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
/** A completed review can still be rated for this long. */
export const RATING_WINDOW_MS = 24 * 60 * 60 * 1000;
/** LeetCode and server clocks may disagree by this much at session start. */
export const START_CLOCK_TOLERANCE_MS = 2_000;
/** Submissions this close before the start need the baseline to be placed. */
export const START_AMBIGUITY_WINDOW_MS = 30_000;
/** Submissions judged shortly after Finish still belong to the session. */
export const END_GRACE_MS = 60_000;
/** Reported cumulative time may exceed wall time by this much (timer jitter). */
export const TIMING_SLACK_MS = 5_000;

type LeaseView = {
  status: PracticeSessionStatus;
  isOpen: boolean;
  ownerToken: string | null;
  ownerLeaseExpiresAt: Date | null;
  lastActivityAt: Date;
};

/** `active` without a live owner lease reads as `interrupted`. Interruption is
 *  never a failure and never implies a rating. */
export function effectiveSessionStatus(session: LeaseView, now: Date): PracticeSessionStatus {
  if (session.status === "active" && !hasLiveLease(session, now)) return "interrupted";
  return session.status;
}

export function hasLiveLease(session: Pick<LeaseView, "ownerLeaseExpiresAt">, now: Date) {
  return session.ownerLeaseExpiresAt != null && session.ownerLeaseExpiresAt.getTime() > now.getTime();
}

/** Open but inactive for more than 24 hours: it must not be resumed or
 *  finished, and its open slot may be released. */
export function isSessionStale(session: Pick<LeaseView, "isOpen" | "lastActivityAt">, now: Date) {
  return session.isOpen && now.getTime() - session.lastActivityAt.getTime() > SESSION_STALE_AFTER_MS;
}

export type Ownership = "owner" | "claimable" | "owned_elsewhere";

/** Whether `token` may act on the session. Without a live lease any tab may
 *  claim it (the previous owner is gone); otherwise only the owner may act,
 *  and another tab must take over explicitly. */
export function ownershipFor(session: LeaseView, token: string, now: Date): Ownership {
  if (session.ownerToken === token) return "owner";
  return hasLiveLease(session, now) ? "owned_elsewhere" : "claimable";
}

/** Rating state as of `now`: a pending or deferred rating is superseded by any
 *  scheduling change since the session started and expires after its window. */
export function effectiveRatingDisposition(
  session: { ratingDisposition: RatingDisposition; ratingExpiresAt: Date | null; scheduleRevisionAtStart: number },
  problemScheduleRevision: number,
  now: Date,
): RatingDisposition {
  if (session.ratingDisposition !== "pending" && session.ratingDisposition !== "deferred") {
    return session.ratingDisposition;
  }
  if (problemScheduleRevision !== session.scheduleRevisionAtStart) return "superseded";
  if (session.ratingExpiresAt != null && session.ratingExpiresAt.getTime() <= now.getTime()) return "expired";
  return session.ratingDisposition;
}

/** Only scheduled reviews (due, or explicitly started early) are rated. */
export function ratingDispositionOnCompletion(type: PracticeSessionType): RatingDisposition {
  return type === "scheduled_review" ? "pending" : "not_applicable";
}

export type SessionKind = { type: PracticeSessionType; reviewIntent: ReviewIntent };
export type SessionKindError = "problem_not_found" | "not_enrolled" | "not_due";

/**
 * Which session a start request creates. A problem new to Ankify, or one whose
 * initial learning never completed, starts initial learning. An enrolled
 * problem is voluntary practice unless the user explicitly chose a review;
 * a due review requires the problem to be due, and an early review of a
 * problem that has meanwhile become due is simply a due review.
 */
export function sessionKindFor(
  mode: PracticeMode,
  problem: { enrollment: "enrolled" | "awaiting_initial"; due: boolean } | null,
): SessionKind | { error: SessionKindError } {
  if (!problem) {
    return mode === "practice" ? { type: "initial_learning", reviewIntent: "none" } : { error: "problem_not_found" };
  }
  if (problem.enrollment === "awaiting_initial") {
    return mode === "practice" ? { type: "initial_learning", reviewIntent: "none" } : { error: "not_enrolled" };
  }
  if (mode === "practice") return { type: "voluntary_practice", reviewIntent: "none" };
  if (mode === "due_review" && !problem.due) return { error: "not_due" };
  return { type: "scheduled_review", reviewIntent: problem.due ? "due" : "early" };
}

/** Compares LeetCode submission ids (decimal strings). `null` when either id
 *  is not a plain decimal number. */
export function compareSubmissionIds(a: string, b: string): -1 | 0 | 1 | null {
  if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return null;
  const left = a.replace(/^0+(?=\d)/, "");
  const right = b.replace(/^0+(?=\d)/, "");
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

export type ObservationPlacement = "in_session" | "ambiguous" | "outside_session";

/**
 * Places a submission observation relative to a session. LeetCode's own
 * submission time decides when known; the baseline (newest id seen at start)
 * resolves submissions made right around the start or reported without a
 * time. Anything contradictory or unplaceable is ambiguous: kept for explicit
 * association, never guessed. Historical submissions stay outside.
 */
export function classifyObservation(
  session: {
    startedAt: Date;
    completedAt: Date | null;
    baselineState: BaselineState;
    baselineSubmissionId: string | null;
  },
  observation: { leetcodeSubmissionId: string | null; submittedAt: Date | null },
): ObservationPlacement {
  const afterBaseline = baselineOrder(session, observation.leetcodeSubmissionId);
  const submittedAt = observation.submittedAt?.getTime();
  if (submittedAt == null) {
    return afterBaseline == null ? "ambiguous" : afterBaseline ? "in_session" : "outside_session";
  }
  if (session.completedAt && submittedAt > session.completedAt.getTime() + END_GRACE_MS) return "outside_session";
  const start = session.startedAt.getTime();
  if (submittedAt >= start - START_CLOCK_TOLERANCE_MS) return "in_session";
  if (submittedAt >= start - START_AMBIGUITY_WINDOW_MS) {
    return afterBaseline == null ? "ambiguous" : afterBaseline ? "in_session" : "outside_session";
  }
  // Clearly before the start. A newer id than the baseline contradicts that.
  return afterBaseline ? "ambiguous" : "outside_session";
}

/** true: after the baseline; false: at or before it; null: cannot tell. */
function baselineOrder(
  session: { baselineState: BaselineState; baselineSubmissionId: string | null },
  leetcodeSubmissionId: string | null,
): boolean | null {
  if (!leetcodeSubmissionId) return null;
  // No submissions existed when the baseline was taken, so any is newer.
  if (session.baselineState === "none") return true;
  if (session.baselineState !== "established" || !session.baselineSubmissionId) return null;
  const order = compareSubmissionIds(leetcodeSubmissionId, session.baselineSubmissionId);
  return order == null ? null : order > 0;
}

/** Clamps a client-reported event time into [min, max]; the caller keeps
 *  `adjusted` so uncertain timing is never presented as exact. */
export function normalizeClientTime(reported: Date | null, bounds: { min: Date; max: Date }) {
  if (reported == null || Number.isNaN(reported.getTime())) return { at: bounds.max, adjusted: true };
  if (reported.getTime() < bounds.min.getTime()) return { at: bounds.min, adjusted: true };
  if (reported.getTime() > bounds.max.getTime()) return { at: bounds.max, adjusted: true };
  return { at: reported, adjusted: false };
}

/**
 * Merges a tab's cumulative timing report. Reports are cumulative and merged
 * with max(), so replayed or reordered heartbeats cannot double count.
 * Observed time is capped by the session's wall time; active (foreground)
 * time by observed time.
 */
export function mergeOwnerTiming(
  current: { ownerActiveMs: number; ownerObservedMs: number },
  reported: { activeMs: number; observedMs: number },
  limits: { committedObservedMs: number; startedAt: Date; now: Date },
) {
  const wallMs = Math.max(0, limits.now.getTime() - limits.startedAt.getTime());
  const observedCap = Math.max(0, wallMs + TIMING_SLACK_MS - limits.committedObservedMs);
  const ownerObservedMs = Math.max(current.ownerObservedMs, Math.min(Math.round(reported.observedMs), observedCap));
  const ownerActiveMs = Math.max(current.ownerActiveMs, Math.min(Math.round(reported.activeMs), ownerObservedMs));
  return { ownerActiveMs, ownerObservedMs };
}
