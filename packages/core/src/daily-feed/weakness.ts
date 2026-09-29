import { SKILL_DIMENSIONS, quizScopeToDimension, type SkillDimension } from "../skills";
import type { FeedParams } from "./params";
import type { DimensionWeakness, FeedEvidence, FeedHistoryItem, TopicWeakness } from "./types";

const DAY_MS = 86_400_000;

export function ageInDays(at: Date, now: Date) {
  return Math.max(0, (now.getTime() - at.getTime()) / DAY_MS);
}

export function decay(ageDays: number, params: FeedParams) {
  return 0.5 ** (ageDays / params.halfLifeDays);
}

function dateKeyToUtc(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error(`Invalid dateKey: ${dateKey}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Whole days from `earlier` to `later` (both `YYYY-MM-DD`). */
export function daysBetweenKeys(earlier: string, later: string) {
  return Math.round((dateKeyToUtc(later) - dateKeyToUtc(earlier)) / DAY_MS);
}

type Signal = { dimension: SkillDimension | null; fail: number; pass: number };

/** Fail/pass weight of one piece of evidence, before decay. */
export function evidenceSignal(evidence: FeedEvidence, params: FeedParams): Signal {
  const w = params.weights;
  switch (evidence.kind) {
    case "mistake":
      return {
        dimension: evidence.dimension,
        fail: w.mistake * (evidence.resolved ? w.resolvedMistakeFactor : 1),
        pass: 0,
      };
    case "quiz_answer":
      return {
        dimension: quizScopeToDimension(evidence.scope),
        fail: evidence.correct ? 0 : w.quizWrong,
        pass: evidence.correct ? w.quizRight : 0,
      };
    case "review_rating":
      return {
        dimension: null,
        fail: evidence.rating === 1 ? w.ratingAgain : evidence.rating === 2 ? w.ratingHard : 0,
        pass: evidence.rating >= 3 ? w.ratingPass : 0,
      };
    case "feed_outcome": {
      const fail =
        evidence.outcome === "failed" ? w.feedFailed
        : evidence.outcome === "shaky" ? w.feedShaky
        : evidence.outcome === "incorrect" ? w.feedQuizIncorrect
        : 0;
      const pass =
        evidence.outcome === "clean" ? w.feedClean
        : evidence.outcome === "correct" ? w.feedQuizCorrect
        : 0;
      return { dimension: evidence.dimension, fail, pass };
    }
  }
}

function globalRate(fail: number, pass: number, params: FeedParams) {
  const rate = (fail + 1) / (fail + pass + 2);
  return Math.min(params.globalRateMax, Math.max(params.globalRateMin, rate));
}

/** Beta-smoothed failure rate times the confidence that there is a weakness at all. */
export function smoothedWeakness(fail: number, pass: number, prior: number, params: FeedParams) {
  const rate = (fail + params.priorStrength * prior) / (fail + pass + params.priorStrength);
  const confidence = fail / (fail + params.confidenceK);
  return { rate, confidence, weakness: rate * confidence };
}

export type WeaknessModel = {
  dimensions: Map<SkillDimension, DimensionWeakness>;
  /** `u_t`: weakness per topic over all evidence. */
  topics: Map<string, number>;
  /** `π_d(t)`: share of dimension d's decayed fail weight on topic t (sums to 1). */
  topicShare: Map<SkillDimension, Map<string, number>>;
  /** Decayed fail weight of dimension d on each problem. */
  problemFail: Map<SkillDimension, Map<string, number>>;
  /** True when any evidence carries a dimension, i.e. a profile exists. */
  hasDimensionEvidence: boolean;
};

function addTo<K>(map: Map<K, number>, key: K, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function nested<K, J>(map: Map<K, Map<J, number>>, key: K) {
  let inner = map.get(key);
  if (!inner) {
    inner = new Map();
    map.set(key, inner);
  }
  return inner;
}

export function computeWeakness({
  evidence,
  history,
  now,
  dateKey,
  params,
}: {
  evidence: readonly FeedEvidence[];
  history: readonly FeedHistoryItem[];
  now: Date;
  dateKey: string;
  params: FeedParams;
}): WeaknessModel {
  const dimFail = new Map<SkillDimension, number>();
  const dimPass = new Map<SkillDimension, number>();
  const topicFail = new Map<string, number>();
  const topicPass = new Map<string, number>();
  const topicShare = new Map<SkillDimension, Map<string, number>>();
  const problemFail = new Map<SkillDimension, Map<string, number>>();
  const counts = new Map<SkillDimension, { mistakes: number; quizCorrect: number; quizTotal: number }>();
  let allFail = 0;
  let allPass = 0;
  let dimensionedFail = 0;
  let dimensionedPass = 0;

  for (const item of evidence) {
    const age = ageInDays(item.at, now);
    if (age > params.maxEvidenceAgeDays) continue;
    const signal = evidenceSignal(item, params);
    const factor = decay(age, params);
    const fail = signal.fail * factor;
    const pass = signal.pass * factor;
    allFail += fail;
    allPass += pass;
    for (const topic of item.topics) {
      addTo(topicFail, topic, fail);
      addTo(topicPass, topic, pass);
    }

    const dimension = signal.dimension;
    if (!dimension) continue;
    dimensionedFail += fail;
    dimensionedPass += pass;
    addTo(dimFail, dimension, fail);
    addTo(dimPass, dimension, pass);
    if (fail > 0) {
      if (item.problemId) addTo(nested(problemFail, dimension), item.problemId, fail);
      for (const topic of item.topics) {
        addTo(nested(topicShare, dimension), topic, fail / item.topics.length);
      }
    }

    const count = counts.get(dimension) ?? { mistakes: 0, quizCorrect: 0, quizTotal: 0 };
    if (item.kind === "mistake" && !item.resolved) count.mistakes += 1;
    if (item.kind === "quiz_answer") {
      count.quizTotal += 1;
      if (item.correct) count.quizCorrect += 1;
    }
    counts.set(dimension, count);
  }

  for (const shares of topicShare.values()) {
    const total = [...shares.values()].reduce((sum, value) => sum + value, 0);
    for (const [topic, value] of shares) shares.set(topic, total > 0 ? value / total : 0);
  }

  const lastWeakServe = new Map<SkillDimension, number>();
  for (const item of history) {
    if (item.lane !== "weak" || !item.dimension) continue;
    const daysAgo = daysBetweenKeys(item.dateKey, dateKey);
    if (daysAgo <= 0) continue;
    const previous = lastWeakServe.get(item.dimension);
    if (previous === undefined || daysAgo < previous) lastWeakServe.set(item.dimension, daysAgo);
  }

  const dimensionPrior = globalRate(dimensionedFail, dimensionedPass, params);
  const dimensions = new Map<SkillDimension, DimensionWeakness>();
  for (const dimension of SKILL_DIMENSIONS) {
    const fail = dimFail.get(dimension) ?? 0;
    const pass = dimPass.get(dimension) ?? 0;
    const { rate, confidence, weakness } = smoothedWeakness(fail, pass, dimensionPrior, params);
    const servedDaysAgo = lastWeakServe.get(dimension);
    const weak =
      weakness >= params.weakEnter ||
      (servedDaysAgo !== undefined && servedDaysAgo <= params.hysteresisDays && weakness >= params.weakExit);
    const count = counts.get(dimension);
    dimensions.set(dimension, {
      dimension,
      fail,
      pass,
      rate,
      confidence,
      weakness,
      weak,
      recovered: !weak && servedDaysAgo !== undefined && servedDaysAgo <= params.recoveredWindowDays,
      recordedMistakes: count?.mistakes ?? 0,
      quizCorrect: count?.quizCorrect ?? 0,
      quizTotal: count?.quizTotal ?? 0,
    });
  }

  const topicPrior = globalRate(allFail, allPass, params);
  const topics = new Map<string, number>();
  for (const topic of new Set([...topicFail.keys(), ...topicPass.keys()])) {
    topics.set(
      topic,
      smoothedWeakness(topicFail.get(topic) ?? 0, topicPass.get(topic) ?? 0, topicPrior, params).weakness,
    );
  }

  return {
    dimensions,
    topics,
    topicShare,
    problemFail,
    hasDimensionEvidence: dimensionedFail + dimensionedPass > 0,
  };
}

export function topicWeaknessList(model: WeaknessModel): TopicWeakness[] {
  return [...model.topics.entries()]
    .map(([topic, weakness]) => ({ topic, weakness }))
    .sort((a, b) => b.weakness - a.weakness || a.topic.localeCompare(b.topic));
}
