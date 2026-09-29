import { quizScopeToDimension, type SkillDimension } from "../skills";
import type { LeetCodeDifficulty } from "../types";
import type { FeedParams } from "./params";
import { unitHash } from "./random";
import type {
  FeedHistoryItem,
  FeedItemKind,
  FeedPlanItem,
  FeedProblem,
  FeedQuizMiss,
  FeedReason,
} from "./types";
import { ageInDays, daysBetweenKeys, decay, type WeaknessModel } from "./weakness";

const DAY_MS = 86_400_000;
const DIFFICULTY_RANK: Record<LeetCodeDifficulty, number> = { Easy: 0, Medium: 1, Hard: 2 };

export type Candidate = Pick<FeedPlanItem, "kind" | "problemId" | "target" | "quiz"> & {
  score: number;
  reasons: FeedReason[];
};

/** Everything candidate selection needs; `usedProblems`/`usedSlugs` grow as
 *  today's slots are filled. */
export type SelectionContext = {
  seed: string;
  now: Date;
  params: FeedParams;
  model: WeaknessModel;
  problems: readonly FeedProblem[];
  problemById: ReadonlyMap<string, FeedProblem>;
  ownedSlugs: ReadonlySet<string>;
  quizMisses: readonly FeedQuizMiss[];
  lastFedProblem: ReadonlyMap<string, number>;
  lastFedSlug: ReadonlyMap<string, number>;
  retriedCorrect: ReadonlySet<string>;
  usedProblems: Set<string>;
  usedSlugs: Set<string>;
};

export function createSelectionContext({
  seed,
  dateKey,
  now,
  params,
  model,
  problems,
  quizMisses,
  history,
}: {
  seed: string;
  dateKey: string;
  now: Date;
  params: FeedParams;
  model: WeaknessModel;
  problems: readonly FeedProblem[];
  quizMisses: readonly FeedQuizMiss[];
  history: readonly FeedHistoryItem[];
}): SelectionContext {
  const lastFedProblem = new Map<string, number>();
  const lastFedSlug = new Map<string, number>();
  const retriedCorrect = new Set<string>();
  const remember = (map: Map<string, number>, key: string, daysAgo: number) => {
    const previous = map.get(key);
    if (previous === undefined || daysAgo < previous) map.set(key, daysAgo);
  };
  for (const item of history) {
    const daysAgo = daysBetweenKeys(item.dateKey, dateKey);
    if (item.kind === "new_problem") {
      if (item.targetSlug) remember(lastFedSlug, item.targetSlug, daysAgo);
    } else if (item.problemId) {
      remember(lastFedProblem, item.problemId, daysAgo);
    }
    if (item.kind === "quiz_retry" && item.outcome === "correct" && item.quizSessionId && item.quizItemId) {
      retriedCorrect.add(`${item.quizSessionId}:${item.quizItemId}`);
    }
  }

  return {
    seed,
    now,
    params,
    model,
    problems,
    problemById: new Map(problems.map((problem) => [problem.id, problem])),
    ownedSlugs: new Set(problems.map((problem) => problem.slug)),
    quizMisses,
    lastFedProblem,
    lastFedSlug,
    retriedCorrect,
    usedProblems: new Set(),
    usedSlugs: new Set(),
  };
}

/**
 * An owned problem can be practiced when it is active, not due within
 * `dueSoonDays` (the scheduled review shouldn't be made artificially easy),
 * not reviewed in the last `recentReviewDays`, not fed within
 * `problemCooldownDays`, and not already used today.
 */
export function isPracticeEligible(problem: FeedProblem, ctx: SelectionContext) {
  const { params, now } = ctx;
  if (problem.archived || problem.due === null) return false;
  if (problem.due.getTime() <= now.getTime() + params.dueSoonDays * DAY_MS) return false;
  if (problem.lastReview && ageInDays(problem.lastReview, now) < params.recentReviewDays) return false;
  const fedDaysAgo = ctx.lastFedProblem.get(problem.id);
  if (fedDaysAgo !== undefined && fedDaysAgo <= params.problemCooldownDays) return false;
  return !ctx.usedProblems.has(problem.id);
}

/** `Σ π_d(t)` over the problem's tags: how much d's failures live in its topics. */
export function topicAffinity(problem: FeedProblem, dimension: SkillDimension, ctx: SelectionContext) {
  const shares = ctx.model.topicShare.get(dimension);
  if (!shares) return 0;
  return problem.topics.reduce((sum, topic) => sum + (shares.get(topic) ?? 0), 0);
}

/** `x / (x + 1)` of the problem's own decayed fail weight for d. */
export function directFailure(problemId: string, dimension: SkillDimension, ctx: SelectionContext) {
  const fail = ctx.model.problemFail.get(dimension)?.get(problemId) ?? 0;
  return fail / (fail + 1);
}

function maxTopicWeakness(problem: FeedProblem, ctx: SelectionContext) {
  return problem.topics.reduce((max, topic) => Math.max(max, ctx.model.topics.get(topic) ?? 0), 0);
}

function lapseTerm(problem: FeedProblem) {
  return Math.min(problem.lapses, 4) / 4;
}

function jitter(ctx: SelectionContext, key: string) {
  return unitHash(ctx.seed, key);
}

function best<T extends { score: number }>(candidates: T[]): T | null {
  return candidates.reduce<T | null>((top, candidate) => (!top || candidate.score > top.score ? candidate : top), null);
}

function drillCandidate(problem: FeedProblem, score: number, ctx: SelectionContext): Candidate {
  const reasons: FeedReason[] = [];
  if (problem.retrievability < ctx.params.forgettingRiskBelow) {
    reasons.push({ code: "forgetting_risk", retrievability: problem.retrievability });
  }
  return { kind: "problem_drill", problemId: problem.id, target: null, quiz: null, score, reasons };
}

/** A drill for a weak dimension: only problems in the topics where d fails,
 *  or where d failed directly. */
export function bestWeakDrill(dimension: SkillDimension, ctx: SelectionContext): Candidate | null {
  const s = ctx.params.score;
  return best(
    ctx.problems.flatMap((problem) => {
      if (!isPracticeEligible(problem, ctx)) return [];
      const affinity = topicAffinity(problem, dimension, ctx);
      const direct = directFailure(problem.id, dimension, ctx);
      if (affinity <= 0 && direct <= 0) return [];
      const score =
        s.affinity * affinity +
        s.direct * direct +
        s.forgetting * (1 - problem.retrievability) +
        s.topicWeakness * maxTopicWeakness(problem, ctx) +
        s.lapses * lapseTerm(problem) +
        s.jitter * jitter(ctx, `drill:${problem.id}`);
      return [drillCandidate(problem, score, ctx)];
    }),
  );
}

/** A check-up drill: any eligible problem, preferring d's topics and fading memories. */
export function bestCheckupDrill(dimension: SkillDimension, ctx: SelectionContext): Candidate | null {
  const s = ctx.params.score;
  return best(
    ctx.problems.flatMap((problem) => {
      if (!isPracticeEligible(problem, ctx)) return [];
      const score =
        s.affinity * topicAffinity(problem, dimension, ctx) +
        s.forgetting * (1 - problem.retrievability) +
        s.lapses * lapseTerm(problem) +
        s.jitter * jitter(ctx, `checkup:${problem.id}`);
      return [drillCandidate(problem, score, ctx)];
    }),
  );
}

/** Cold start: a drill on a problem tagged with a weak topic, no dimension. */
export function bestTopicDrill(topic: string, ctx: SelectionContext): Candidate | null {
  const s = ctx.params.score;
  return best(
    ctx.problems.flatMap((problem) => {
      if (!problem.topics.includes(topic) || !isPracticeEligible(problem, ctx)) return [];
      const score =
        s.forgetting * (1 - problem.retrievability) +
        s.lapses * lapseTerm(problem) +
        s.jitter * jitter(ctx, `topic:${problem.id}`);
      return [drillCandidate(problem, score, ctx)];
    }),
  );
}

/** Re-ask a missed quiz item of dimension d, missed at least
 *  `quizMissMinAgeDays` ago and not since answered correctly in the feed. */
export function bestQuizRetry(dimension: SkillDimension, ctx: SelectionContext): Candidate | null {
  const { params, now } = ctx;
  return best(
    ctx.quizMisses.flatMap((miss) => {
      if (quizScopeToDimension(miss.scope) !== dimension) return [];
      if (ctx.retriedCorrect.has(`${miss.quizSessionId}:${miss.quizItemId}`)) return [];
      const age = ageInDays(miss.missedAt, now);
      if (age < params.quizMissMinAgeDays) return [];
      const problem = ctx.problemById.get(miss.problemId);
      if (!problem || !isPracticeEligible(problem, ctx)) return [];
      const score =
        decay(age, params) +
        (1 - problem.retrievability) +
        params.score.jitter * jitter(ctx, `quiz:${miss.quizSessionId}:${miss.quizItemId}`);
      return [
        {
          kind: "quiz_retry" as const,
          problemId: problem.id,
          target: null,
          quiz: { sessionId: miss.quizSessionId, itemId: miss.quizItemId },
          score,
          reasons: [{ code: "missed_quiz" as const, missedAt: miss.missedAt.toISOString() }],
        },
      ];
    }),
  );
}

function topTopics(dimension: SkillDimension, ctx: SelectionContext) {
  const shares = ctx.model.topicShare.get(dimension);
  if (!shares) return new Set<string>();
  return new Set(
    [...shares.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, ctx.params.topTopicsForNewProblems)
      .map(([topic]) => topic),
  );
}

/** An unseen, free similar question of a problem where d failed, or of a
 *  problem in one of d's top topics. */
export function bestNewProblem(dimension: SkillDimension, ctx: SelectionContext): Candidate | null {
  const { params } = ctx;
  const top = topTopics(dimension, ctx);
  const bySlug = new Map<string, Candidate>();

  for (const parent of ctx.problems) {
    if (parent.archived) continue;
    const direct = directFailure(parent.id, dimension, ctx);
    if (direct <= 0 && !parent.topics.some((topic) => top.has(topic))) continue;
    const affinity = topicAffinity(parent, dimension, ctx);

    for (const similar of parent.similar) {
      if (similar.paidOnly || ctx.ownedSlugs.has(similar.slug) || ctx.usedSlugs.has(similar.slug)) continue;
      const fedDaysAgo = ctx.lastFedSlug.get(similar.slug);
      if (fedDaysAgo !== undefined && fedDaysAgo <= params.newProblemCooldownDays) continue;
      const fit =
        similar.difficulty === null ? 0
        : DIFFICULTY_RANK[similar.difficulty] <= DIFFICULTY_RANK[parent.difficulty] ? params.score.difficultyFit
        : -params.score.difficultyFit;
      const score =
        params.score.direct * direct +
        params.score.affinity * affinity +
        fit +
        params.score.jitter * jitter(ctx, `new:${similar.slug}`);
      const previous = bySlug.get(similar.slug);
      if (previous && previous.score >= score) continue;
      bySlug.set(similar.slug, {
        kind: "new_problem",
        problemId: parent.id,
        target: { slug: similar.slug, title: similar.title, difficulty: similar.difficulty },
        quiz: null,
        score,
        reasons: [{ code: "similar_to", problemId: parent.id, title: parent.title }],
      });
    }
  }
  return best([...bySlug.values()]);
}

export function markUsed(ctx: SelectionContext, item: { kind: FeedItemKind; problemId: string | null; target: FeedPlanItem["target"] }) {
  if (item.kind === "new_problem") {
    if (item.target) ctx.usedSlugs.add(item.target.slug);
  } else if (item.problemId) {
    ctx.usedProblems.add(item.problemId);
  }
}
