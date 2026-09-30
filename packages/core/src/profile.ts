import { FEED_PARAMS } from "./daily-feed/params";
import { ageInDays, decay, smoothedWeakness } from "./daily-feed/weakness";
import { SKILL_DIMENSIONS, type SkillDimension } from "./skills";
import type { FsrsRating } from "./types";

/**
 * The mistake profile: which skill dimensions keep failing, computed from
 * practice contexts rather than from how often something was recorded.
 *
 * - A context is one practice session, or, for records made before sessions
 *   existed, the record's own source. Each (context, dimension) counts once,
 *   so a user's record and an AI finding from the same session never double.
 * - Only confirmed records make a dimension weak; unconfirmed AI candidates
 *   are reported apart and weigh nothing.
 * - Accepted outcomes and Good/Easy ratings are success evidence for the
 *   problem's topics, not mastery of every dimension; a dimension improves
 *   only through the user's explicit confirmation.
 * - Interrupted or abandoned sessions and missing evidence are not failures.
 * Decay and smoothing are the daily feed's (21-day half-life, 90-day window).
 */

export type ProfileSessionInput = {
  id: string;
  problemId: string;
  topics: readonly string[];
  status: "active" | "interrupted" | "completed" | "abandoned";
  outcome: "accepted" | "failed" | "unknown" | null;
  completedAt: Date | null;
  /** The session's rating, when one was given and not undone. */
  rating: FsrsRating | null;
  verdicts: readonly { verdict: string; at: Date | null }[];
  partialCapture: boolean;
  ambiguousObservations: number;
};

export type ProfileMistakeInput = {
  id: string;
  problemId: string;
  topics: readonly string[];
  category: SkillDimension;
  status: "candidate" | "confirmed" | "dismissed";
  origin: "user" | "ai_suggested";
  resolved: boolean;
  createdAt: Date;
  /** Session it happened in; else the legacy source (submission, quiz item, rating, or the record). */
  practiceSessionId: string | null;
  legacySourceKey: string;
};

export type ProfileImprovementInput = {
  practiceSessionId: string;
  problemId: string;
  category: SkillDimension;
  at: Date;
};

/** Ratings from before practice sessions (the legacy review route). */
export type ProfileLegacyRatingInput = { problemId: string; topics: readonly string[]; rating: FsrsRating; at: Date };

export type ProfileInput = {
  now: Date;
  sessions: readonly ProfileSessionInput[];
  mistakes: readonly ProfileMistakeInput[];
  improvements: readonly ProfileImprovementInput[];
  legacyRatings: readonly ProfileLegacyRatingInput[];
  /** Length of the trend periods compared (current vs previous). */
  trendDays?: number;
};

export const PROFILE_READINESS = {
  /** Completed sessions, across distinct problems, before targeting is personalized. */
  sessions: 3,
  problems: 2,
  /** Confirmed contexts, across distinct problems, before a dimension is targeted. */
  categoryContexts: 2,
  categoryProblems: 2,
} as const;

const IMPROVEMENT_WEIGHT = 2;
const OUTCOME_FAILED_WEIGHT = 1;

export type SessionSummary = {
  /** Judged submissions in order. */
  attempts: number;
  /** Failed submissions before the first Accepted (all of them if none was accepted). */
  failedBeforeAccepted: number;
  firstTryAccepted: boolean;
  firstAcceptedAt: Date | null;
  /** Verdicts, oldest first, with consecutive repeats collapsed ("WA x3"). */
  sequence: { verdict: string; count: number }[];
};

/** Verdict and correction sequence of one session, counted once. */
export function summarizeSession(verdicts: readonly { verdict: string; at: Date | null }[]): SessionSummary {
  const ordered = [...verdicts].sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
  const firstAccepted = ordered.findIndex((item) => item.verdict === "Accepted");
  const sequence: SessionSummary["sequence"] = [];
  for (const item of ordered) {
    const last = sequence.at(-1);
    if (last?.verdict === item.verdict) last.count += 1;
    else sequence.push({ verdict: item.verdict, count: 1 });
  }
  return {
    attempts: ordered.length,
    failedBeforeAccepted: firstAccepted < 0 ? ordered.length : firstAccepted,
    firstTryAccepted: firstAccepted === 0,
    firstAcceptedAt: firstAccepted < 0 ? null : ordered[firstAccepted]!.at,
    sequence,
  };
}

export type CategoryProfile = {
  category: SkillDimension;
  weakness: number;
  weak: boolean;
  /** Enough confirmed contexts across problems to target this dimension. */
  ready: boolean;
  contexts: number;
  problems: number;
  unresolved: number;
  resolved: number;
  improvements: number;
  lastSeenAt: Date | null;
  /** Confirmed contexts in the current and the previous trend period. */
  trend: { current: number; previous: number };
  /** Up to three recent confirmed records, one per context. */
  exampleIds: string[];
};

export type TopicProfile = {
  topic: string;
  sessions: number;
  accepted: number;
  failed: number;
  firstTryAccepted: number;
  /** Median failed submissions before Accepted, over accepted sessions. */
  medianFailedBeforeAccepted: number | null;
  weakness: number;
};

export type MistakeProfile = {
  readiness: {
    completedSessions: number;
    distinctProblems: number;
    personalized: boolean;
  };
  categories: CategoryProfile[];
  /** Unconfirmed AI findings, newest first; never counted as weakness. */
  candidateIds: string[];
  topics: TopicProfile[];
  signals: {
    sessions: { completed: number; accepted: number; failed: number; unknown: number; interrupted: number; abandoned: number };
    ratings: { again: number; hard: number; good: number; easy: number };
  };
  /** Evidence known to be incomplete; shown so counts are read with care. */
  incomplete: { sessionsWithPartialCapture: number; ambiguousObservations: number };
};

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

export function contextKey(mistake: Pick<ProfileMistakeInput, "practiceSessionId" | "legacySourceKey">) {
  return mistake.practiceSessionId ? `session:${mistake.practiceSessionId}` : `legacy:${mistake.legacySourceKey}`;
}

export function computeMistakeProfile(input: ProfileInput, params = FEED_PARAMS): MistakeProfile {
  const { now } = input;
  const trendDays = input.trendDays ?? 30;
  const inWindow = (at: Date) => ageInDays(at, now) <= params.maxEvidenceAgeDays;
  const weight = (at: Date) => decay(ageInDays(at, now), params);

  // Dimensions: one contribution per confirmed (context, dimension).
  type Context = { problemId: string; at: Date; resolvedOnly: boolean; recordIds: string[]; unresolved: number; resolved: number };
  const byDimension = new Map<SkillDimension, Map<string, Context>>();
  const candidates: ProfileMistakeInput[] = [];
  for (const mistake of input.mistakes) {
    if (!inWindow(mistake.createdAt)) continue;
    if (mistake.status === "candidate") {
      candidates.push(mistake);
      continue;
    }
    if (mistake.status !== "confirmed") continue;
    const contexts = byDimension.get(mistake.category) ?? new Map<string, Context>();
    byDimension.set(mistake.category, contexts);
    const key = contextKey(mistake);
    const existing = contexts.get(key);
    if (existing) {
      existing.at = existing.at < mistake.createdAt ? existing.at : mistake.createdAt;
      existing.resolvedOnly &&= mistake.resolved;
      existing.recordIds.push(mistake.id);
      if (mistake.resolved) existing.resolved += 1;
      else existing.unresolved += 1;
    } else {
      contexts.set(key, {
        problemId: mistake.problemId,
        at: mistake.createdAt,
        resolvedOnly: mistake.resolved,
        recordIds: [mistake.id],
        unresolved: mistake.resolved ? 0 : 1,
        resolved: mistake.resolved ? 1 : 0,
      });
    }
  }

  const improvements = new Map<SkillDimension, { weight: number; count: number }>();
  const seenImprovement = new Set<string>();
  for (const improvement of input.improvements) {
    if (!inWindow(improvement.at)) continue;
    const key = `${improvement.practiceSessionId}:${improvement.category}`;
    if (seenImprovement.has(key)) continue;
    seenImprovement.add(key);
    const entry = improvements.get(improvement.category) ?? { weight: 0, count: 0 };
    entry.weight += IMPROVEMENT_WEIGHT * weight(improvement.at);
    entry.count += 1;
    improvements.set(improvement.category, entry);
  }

  let allFail = 0;
  let allPass = 0;
  const dimensionTotals = new Map<SkillDimension, { fail: number; pass: number }>();
  for (const dimension of SKILL_DIMENSIONS) {
    let fail = 0;
    for (const context of byDimension.get(dimension)?.values() ?? []) {
      fail += params.weights.mistake * (context.resolvedOnly ? params.weights.resolvedMistakeFactor : 1) * weight(context.at);
    }
    const pass = improvements.get(dimension)?.weight ?? 0;
    dimensionTotals.set(dimension, { fail, pass });
    allFail += fail;
    allPass += pass;
  }
  const prior = Math.min(params.globalRateMax, Math.max(params.globalRateMin, (allFail + 1) / (allFail + allPass + 2)));

  const trendStart = now.getTime() - trendDays * 86_400_000;
  const previousStart = trendStart - trendDays * 86_400_000;
  const categories: CategoryProfile[] = [];
  for (const dimension of SKILL_DIMENSIONS) {
    const contexts = [...(byDimension.get(dimension)?.values() ?? [])];
    const totals = dimensionTotals.get(dimension)!;
    if (contexts.length === 0 && totals.pass === 0) continue;
    const { weakness } = smoothedWeakness(totals.fail, totals.pass, prior, params);
    const problems = new Set(contexts.map((context) => context.problemId)).size;
    const newest = [...contexts].sort((a, b) => b.at.getTime() - a.at.getTime());
    categories.push({
      category: dimension,
      weakness,
      weak: weakness >= params.weakEnter,
      ready: contexts.length >= PROFILE_READINESS.categoryContexts && problems >= PROFILE_READINESS.categoryProblems,
      contexts: contexts.length,
      problems,
      unresolved: contexts.reduce((sum, context) => sum + context.unresolved, 0),
      resolved: contexts.reduce((sum, context) => sum + context.resolved, 0),
      improvements: improvements.get(dimension)?.count ?? 0,
      lastSeenAt: newest[0]?.at ?? null,
      trend: {
        current: contexts.filter((context) => context.at.getTime() >= trendStart).length,
        previous: contexts.filter((context) => context.at.getTime() >= previousStart && context.at.getTime() < trendStart).length,
      },
      exampleIds: newest.slice(0, 3).map((context) => context.recordIds[0]!),
    });
  }
  categories.sort((a, b) => b.weakness - a.weakness || b.contexts - a.contexts || a.category.localeCompare(b.category));

  // Topics: session outcomes and ratings, one contribution per session or legacy rating.
  const topicStats = new Map<string, { fail: number; pass: number; sessions: number; accepted: number; failed: number; firstTry: number; corrections: number[] }>();
  const topic = (name: string) => {
    let entry = topicStats.get(name);
    if (!entry) {
      entry = { fail: 0, pass: 0, sessions: 0, accepted: 0, failed: 0, firstTry: 0, corrections: [] };
      topicStats.set(name, entry);
    }
    return entry;
  };
  const ratingSignal = (rating: FsrsRating) => ({
    fail: rating === 1 ? params.weights.ratingAgain : rating === 2 ? params.weights.ratingHard : 0,
    pass: rating >= 3 ? params.weights.ratingPass : 0,
  });
  const signals: MistakeProfile["signals"] = {
    sessions: { completed: 0, accepted: 0, failed: 0, unknown: 0, interrupted: 0, abandoned: 0 },
    ratings: { again: 0, hard: 0, good: 0, easy: 0 },
  };
  const incomplete = { sessionsWithPartialCapture: 0, ambiguousObservations: 0 };
  const RATING_KEYS = { 1: "again", 2: "hard", 3: "good", 4: "easy" } as const;
  const countRating = (rating: FsrsRating) => {
    signals.ratings[RATING_KEYS[rating]] += 1;
  };
  const completedProblems = new Set<string>();

  for (const session of input.sessions) {
    if (session.status === "interrupted" || session.status === "active") {
      if (session.status === "interrupted") signals.sessions.interrupted += 1;
      continue;
    }
    if (session.status === "abandoned") {
      signals.sessions.abandoned += 1;
      continue;
    }
    if (!session.completedAt || !inWindow(session.completedAt)) continue;
    signals.sessions.completed += 1;
    completedProblems.add(session.problemId);
    signals.sessions[session.outcome ?? "unknown"] += 1;
    if (session.partialCapture) incomplete.sessionsWithPartialCapture += 1;
    incomplete.ambiguousObservations += session.ambiguousObservations;
    if (session.rating) countRating(session.rating);
    const summary = summarizeSession(session.verdicts);
    const signal = session.rating
      ? ratingSignal(session.rating)
      : session.outcome === "accepted"
        ? { fail: 0, pass: params.weights.ratingPass }
        : session.outcome === "failed"
          ? { fail: OUTCOME_FAILED_WEIGHT, pass: 0 }
          : { fail: 0, pass: 0 };
    const factor = weight(session.completedAt);
    for (const name of session.topics) {
      const entry = topic(name);
      entry.fail += signal.fail * factor;
      entry.pass += signal.pass * factor;
      entry.sessions += 1;
      if (session.outcome === "accepted") {
        entry.accepted += 1;
        entry.corrections.push(summary.failedBeforeAccepted);
        if (summary.firstTryAccepted) entry.firstTry += 1;
      }
      if (session.outcome === "failed") entry.failed += 1;
    }
  }
  for (const rating of input.legacyRatings) {
    if (!inWindow(rating.at)) continue;
    countRating(rating.rating);
    const signal = ratingSignal(rating.rating);
    const factor = weight(rating.at);
    for (const name of rating.topics) {
      const entry = topic(name);
      entry.fail += signal.fail * factor;
      entry.pass += signal.pass * factor;
    }
  }
  let topicFail = 0;
  let topicPass = 0;
  for (const entry of topicStats.values()) {
    topicFail += entry.fail;
    topicPass += entry.pass;
  }
  const topicPrior = Math.min(params.globalRateMax, Math.max(params.globalRateMin, (topicFail + 1) / (topicFail + topicPass + 2)));
  const topics: TopicProfile[] = [...topicStats.entries()]
    .map(([name, entry]) => ({
      topic: name,
      sessions: entry.sessions,
      accepted: entry.accepted,
      failed: entry.failed,
      firstTryAccepted: entry.firstTry,
      medianFailedBeforeAccepted: median(entry.corrections),
      weakness: smoothedWeakness(entry.fail, entry.pass, topicPrior, params).weakness,
    }))
    .sort((a, b) => b.weakness - a.weakness || b.sessions - a.sessions || a.topic.localeCompare(b.topic));

  return {
    readiness: {
      completedSessions: signals.sessions.completed,
      distinctProblems: completedProblems.size,
      personalized: signals.sessions.completed >= PROFILE_READINESS.sessions && completedProblems.size >= PROFILE_READINESS.problems,
    },
    categories,
    candidateIds: candidates.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((mistake) => mistake.id),
    topics,
    signals,
    incomplete,
  };
}
