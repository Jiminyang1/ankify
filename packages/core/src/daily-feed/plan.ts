import type { SkillDimension } from "../skills";
import { deficits, nextType, typeShares, type FeedTypeKey } from "./allocate";
import { FEED_PARAMS, type FeedParams } from "./params";
import { unitHash } from "./random";
import {
  bestCheckupDrill,
  bestNewProblem,
  bestQuizRetry,
  bestTopicDrill,
  bestWeakDrill,
  createSelectionContext,
  markUsed,
  type Candidate,
  type SelectionContext,
} from "./select";
import type {
  DailyFeedInput,
  DailyFeedPlan,
  FeedHistoryItem,
  FeedItemKind,
  FeedLane,
  FeedPlanItem,
  FeedReason,
} from "./types";
import { computeWeakness, daysBetweenKeys, topicWeaknessList, type WeaknessModel } from "./weakness";

type PlannedItem = Omit<FeedPlanItem, "slot">;

type CheckupTarget =
  | { type: "recovered" | "explore"; dimension: SkillDimension }
  | { type: "topic"; topic: string };

const KIND_ORDER: Record<FeedItemKind, number> = { quiz_retry: 0, problem_drill: 1, new_problem: 2 };

function countBy<K>(items: readonly FeedHistoryItem[], key: (item: FeedHistoryItem) => K | null) {
  const counts = new Map<K, number>();
  for (const item of items) {
    const k = key(item);
    if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/**
 * Plans today's practice items. Pure and deterministic: the same input always
 * yields the same plan. See docs/DAILY_FEED_PLAN.md.
 */
export function planDailyFeed(input: DailyFeedInput): DailyFeedPlan {
  const params = input.params ?? FEED_PARAMS;
  const history = input.history.filter((item) => daysBetweenKeys(item.dateKey, input.dateKey) > 0);
  const model = computeWeakness({
    evidence: input.evidence,
    history,
    now: input.now,
    dateKey: input.dateKey,
    params,
  });
  const summary = { dimensions: [...model.dimensions.values()], topics: topicWeaknessList(model) };
  const slots = Math.max(0, Math.min(params.maxDailyItems, Math.floor(input.settings.dailyItems)));
  if (slots === 0) return { items: [], ...summary };

  const seed = `${input.seed}:${input.dateKey}`;
  const ctx = createSelectionContext({
    seed,
    dateKey: input.dateKey,
    now: input.now,
    params,
    model,
    problems: input.problems,
    quizMisses: input.quizMisses,
    history,
  });

  const weak = new Map(
    [...model.dimensions.values()].filter((d) => d.weak).map((d) => [d.dimension, d.weakness] as const),
  );
  const window = history.filter((item) => daysBetweenKeys(item.dateKey, input.dateKey) <= params.allocationWindowDays);
  const typeDeficit = deficits(
    typeShares(weak, params),
    countBy<FeedTypeKey>(window, (item) => (item.lane === "checkup" ? "checkup" : item.dimension)),
    slots,
  );
  const kindShares = new Map<FeedItemKind, number>([
    ["problem_drill", params.kindShares.problem_drill],
    ["quiz_retry", params.kindShares.quiz_retry],
    ["new_problem", input.settings.includeNewProblems ? params.kindShares.new_problem : 0],
  ]);
  const kindDeficit = deficits(kindShares, countBy(window, (item) => item.kind), slots);

  const state = { newProblems: 0, usedTargets: new Set<string>() };
  const checkupTargets = buildCheckupTargets(model, history, input.dateKey, seed, params);

  const pickForDimension = (dimension: SkillDimension, lane: FeedLane): Candidate | null => {
    const kinds = [...kindShares.keys()]
      .filter((kind) => kindShares.get(kind)! > 0)
      .filter((kind) => kind !== "new_problem" || (lane === "weak" && state.newProblems < params.maxNewProblemsPerDay))
      .sort((a, b) => kindDeficit.get(b)! - kindDeficit.get(a)! || KIND_ORDER[a] - KIND_ORDER[b]);
    for (const kind of kinds) {
      const candidate =
        kind === "quiz_retry" ? bestQuizRetry(dimension, ctx)
        : kind === "new_problem" ? bestNewProblem(dimension, ctx)
        : lane === "weak" ? bestWeakDrill(dimension, ctx)
        : bestCheckupDrill(dimension, ctx);
      if (candidate) return candidate;
    }
    return null;
  };

  const pickWeak = (dimension: SkillDimension): PlannedItem | null => {
    const candidate = pickForDimension(dimension, "weak");
    if (!candidate) return null;
    return toItem(candidate, "weak", dimension, [...weakReasons(dimension, model, ctx), ...candidate.reasons]);
  };

  const pickCheckup = (): PlannedItem | null => {
    for (const target of checkupTargets) {
      const key = target.type === "topic" ? `topic:${target.topic}` : `dimension:${target.dimension}`;
      if (state.usedTargets.has(key)) continue;
      const candidate =
        target.type === "topic" ? bestTopicDrill(target.topic, ctx) : pickForDimension(target.dimension, "checkup");
      if (!candidate) continue;
      state.usedTargets.add(key);
      const reason: FeedReason =
        target.type === "topic" ? { code: "topic_weakness", topic: target.topic }
        : target.type === "recovered" ? { code: "checkup", dimension: target.dimension }
        : { code: "explore", dimension: target.dimension };
      return toItem(candidate, "checkup", target.type === "topic" ? null : target.dimension, [
        reason,
        ...candidate.reasons,
      ]);
    }
    return null;
  };

  const planned: PlannedItem[] = [];
  const servedToday = new Map<FeedTypeKey, number>();
  const exhausted = new Set<FeedTypeKey>();
  const perDayCap = Math.max(1, slots - 1);

  while (planned.length < slots) {
    const type = nextType({
      deficit: typeDeficit,
      servedToday,
      exhausted,
      perDayCap,
      tieBreak: (key) => unitHash(seed, `type:${key}`),
    });
    if (type === null) break;
    const item = type === "checkup" ? pickCheckup() : pickWeak(type);
    if (!item) {
      exhausted.add(type);
      continue;
    }
    typeDeficit.set(type, typeDeficit.get(type)! - 1);
    servedToday.set(type, (servedToday.get(type) ?? 0) + 1);
    kindDeficit.set(item.kind, kindDeficit.get(item.kind)! - 1);
    if (item.kind === "new_problem") state.newProblems += 1;
    markUsed(ctx, item);
    planned.push(item);
  }

  return { items: orderItems(planned), ...summary };
}

function toItem(
  candidate: Candidate,
  lane: FeedLane,
  dimension: SkillDimension | null,
  reasons: FeedReason[],
): PlannedItem {
  return {
    lane,
    kind: candidate.kind,
    dimension,
    problemId: candidate.problemId,
    target: candidate.target,
    quiz: candidate.quiz,
    reasons,
  };
}

function weakReasons(dimension: SkillDimension, model: WeaknessModel, ctx: SelectionContext): FeedReason[] {
  const stats = model.dimensions.get(dimension)!;
  const reasons: FeedReason[] = [];
  if (stats.recordedMistakes > 0) {
    const shares = ctx.model.topicShare.get(dimension);
    const topTopic = shares
      ? [...shares.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
      : null;
    reasons.push({ code: "recorded_mistakes", dimension, count: stats.recordedMistakes, topic: topTopic });
  }
  if (stats.quizTotal > 0) {
    reasons.push({ code: "quiz_accuracy", dimension, correct: stats.quizCorrect, total: stats.quizTotal });
  }
  return reasons;
}

/**
 * Check-up order: recovered dimensions (least recently checked first), then
 * one exploration pick (least evidence, never `other`), then weak topics.
 */
function buildCheckupTargets(
  model: WeaknessModel,
  history: readonly FeedHistoryItem[],
  dateKey: string,
  seed: string,
  params: FeedParams,
): CheckupTarget[] {
  const lastCheckup = new Map<SkillDimension, number>();
  for (const item of history) {
    if (item.lane !== "checkup" || !item.dimension) continue;
    const daysAgo = daysBetweenKeys(item.dateKey, dateKey);
    const previous = lastCheckup.get(item.dimension);
    if (previous === undefined || daysAgo < previous) lastCheckup.set(item.dimension, daysAgo);
  }
  const hash = (key: string) => unitHash(seed, `checkup:${key}`);
  const dims = [...model.dimensions.values()];

  const recovered = dims
    .filter((d) => d.recovered)
    .sort(
      (a, b) =>
        (lastCheckup.get(b.dimension) ?? Infinity) - (lastCheckup.get(a.dimension) ?? Infinity) ||
        hash(b.dimension) - hash(a.dimension),
    )
    .map((d): CheckupTarget => ({ type: "recovered", dimension: d.dimension }));

  const explore = model.hasDimensionEvidence
    ? dims
        .filter((d) => !d.weak && !d.recovered && d.dimension !== "other")
        .sort((a, b) => a.fail + a.pass - (b.fail + b.pass) || hash(b.dimension) - hash(a.dimension))
        .slice(0, 1)
        .map((d): CheckupTarget => ({ type: "explore", dimension: d.dimension }))
    : [];

  const topics = topicWeaknessList(model)
    .filter((t) => t.weakness >= params.weakEnter)
    .map((t): CheckupTarget => ({ type: "topic", topic: t.topic }));

  return [...recovered, ...explore, ...topics];
}

/** Quiz retries first as a warm-up, then drills, then the new problem;
 *  inside each group, avoid two adjacent items of the same dimension. */
function orderItems(items: PlannedItem[]): FeedPlanItem[] {
  const ordered: PlannedItem[] = [];
  const groups = [...items].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  for (const kind of ["quiz_retry", "problem_drill", "new_problem"] as const) {
    const remaining = groups.filter((item) => item.kind === kind);
    while (remaining.length > 0) {
      const previous = ordered.at(-1)?.dimension;
      const index = remaining.findIndex((item) => item.dimension !== previous);
      ordered.push(remaining.splice(Math.max(0, index), 1)[0]!);
    }
  }
  return ordered.map((item, slot) => ({ slot, ...item }));
}
