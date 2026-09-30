import { deficits, nextType, typeShares, type FeedTypeKey } from "../daily-feed/allocate";
import { FEED_PARAMS } from "../daily-feed/params";
import { unitHash } from "../daily-feed/random";
import { daysBetweenKeys } from "../daily-feed/weakness";
import type { SkillDimension } from "../skills";
import type { LeetCodeDifficulty } from "../types";
import type {
  GeneralPracticeWhy,
  SuggestionCandidate,
  SuggestionPlan,
  SuggestionPlanInput,
  SuggestionProblem,
  SuggestionReason,
} from "./types";

/** Stored with every suggestion; bump when ranking or eligibility changes. */
export const SUGGESTION_PLANNER_VERSION = "suggestions-v1";

export const SUGGESTION_PARAMS = {
  /** A problem suggested this recently is not suggested again. */
  exposureDays: 30,
  /** The rotation counts suggestions over this window (today included). */
  allocationWindowDays: 14,
  /** Recently practiced problems that set the preferred difficulty. */
  recentDifficultyCount: 10,
  score: { direct: 1, affinity: 2, similar: 0.5, topic: 1, difficultyFit: 0.5, jitter: 0.1 },
};
export type SuggestionParams = typeof SUGGESTION_PARAMS;

const RANK: Record<LeetCodeDifficulty, number> = { Easy: 0, Medium: 1, Hard: 2 };
const byRank: LeetCodeDifficulty[] = ["Easy", "Medium", "Hard"];

type Scored = { candidate: SuggestionCandidate; score: number; reasons: SuggestionReason[] };

/**
 * Plans one new-problem suggestion. Pure and deterministic: the same input
 * gives the same plan. Weak, confirmed dimensions share the suggestions by
 * the daily feed's weighted rotation (weakness shares, deficits over the last
 * two weeks, a seeded tie-break); the rest is general practice. Only verified,
 * free problems the user has not attempted, and that were not suggested in
 * the last 30 days or are still pending, are ever returned.
 */
export function planSuggestion(input: SuggestionPlanInput, params: SuggestionParams = SUGGESTION_PARAMS): SuggestionPlan {
  const seed = `${input.seed}|${input.dateKey}|${input.ordinal}|${SUGGESTION_PLANNER_VERSION}`;
  const hash = (key: string) => unitHash(seed, key);

  const blocked = new Set(input.attempted);
  for (const item of input.history) {
    if (item.pending || daysBetweenKeys(item.dateKey, input.dateKey) <= params.exposureDays) blocked.add(item.slug);
  }
  const bySlug = new Map<string, SuggestionCandidate>();
  for (const candidate of input.candidates) {
    if (!candidate.verifiedAt || candidate.paidOnly || blocked.has(candidate.slug)) continue;
    const previous = bySlug.get(candidate.slug);
    // The most recently verified metadata wins.
    if (!previous || candidate.verifiedAt > previous.verifiedAt!) bySlug.set(candidate.slug, candidate);
  }
  const eligible = [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  if (eligible.length === 0) return { kind: "none", reason: "no_candidates" };

  const parentsOf = new Map<string, SuggestionProblem[]>();
  for (const problem of [...input.problems].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const slug of new Set(problem.similarSlugs)) parentsOf.set(slug, [...(parentsOf.get(slug) ?? []), problem]);
  }
  const topicsOf = (candidate: SuggestionCandidate) =>
    candidate.topicTags.length > 0
      ? [...candidate.topicTags]
      : [...new Set((parentsOf.get(candidate.slug) ?? []).flatMap((problem) => problem.topics))];

  const targets = input.profile.personalized ? input.profile.categories.filter((category) => category.weak && category.ready) : [];
  const shares = typeShares(new Map(targets.map((category) => [category.category, category.weakness])), FEED_PARAMS);
  const recent = input.history.filter((item) => {
    const days = daysBetweenKeys(item.dateKey, input.dateKey);
    return days >= 0 && days <= params.allocationWindowDays;
  });
  const key = (category: SkillDimension | null): FeedTypeKey => category ?? "checkup";
  const deficit = deficits(shares, countBy(recent, (item) => key(item.category)), 1);
  const servedToday = countBy(recent.filter((item) => item.dateKey === input.dateKey), (item) => key(item.category));
  const exhausted = new Set<FeedTypeKey>();

  const topicShare = categoryTopicShares(input.problems);
  const reference = typicalDifficulty(input.recentDifficulties.slice(0, params.recentDifficultyCount));
  const fit = (difficulty: LeetCodeDifficulty, than: LeetCodeDifficulty) =>
    RANK[difficulty] <= RANK[than] ? params.score.difficultyFit : -params.score.difficultyFit;

  const targeted = (category: SkillDimension): Scored | null => {
    const shares = topicShare.get(category) ?? new Map<string, number>();
    const contexts = targets.find((target) => target.category === category)!.contexts;
    return best(
      eligible.flatMap((candidate): Scored[] => {
        const parents = parentsOf.get(candidate.slug) ?? [];
        // The practiced problem with the most confirmed mistakes of this category.
        const parent = parents.reduce<SuggestionProblem | null>(
          (top, problem) => ((problem.confirmedContexts[category] ?? 0) > (top?.confirmedContexts[category] ?? 0) ? problem : top),
          null,
        );
        const failed = parent?.confirmedContexts[category] ?? 0;
        const direct = failed / (failed + 1);
        const topics = topicsOf(candidate);
        const affinity = topics.reduce((sum, topic) => sum + (shares.get(topic) ?? 0), 0);
        if (direct <= 0 && affinity <= 0) return [];
        const s = params.score;
        const score = s.direct * direct + s.affinity * affinity + fit(candidate.difficulty, parent?.difficulty ?? reference ?? "Medium") + s.jitter * hash(`candidate:${candidate.slug}`);
        const topTopic = [...topics].sort((a, b) => (shares.get(b) ?? 0) - (shares.get(a) ?? 0) || a.localeCompare(b))[0]!;
        const why: SuggestionReason =
          parent && failed > 0
            ? { code: "similar_to", problemId: parent.id, title: parent.title, category }
            : { code: "topic_match", topic: topTopic };
        return [{ candidate, score, reasons: [{ code: "category_focus", category, contexts }, why] }];
      }),
    );
  };

  const general = (why: GeneralPracticeWhy): Scored => {
    const practiced = new Map(input.profile.topics.map((topic) => [topic.topic, topic.sessions]));
    const most = Math.max(1, ...practiced.values());
    return best(
      eligible.map((candidate): Scored => {
        const parents = parentsOf.get(candidate.slug) ?? [];
        const topics = topicsOf(candidate);
        const topTopic = [...topics].sort((a, b) => (practiced.get(b) ?? 0) - (practiced.get(a) ?? 0) || a.localeCompare(b))[0];
        const preference = topTopic ? (practiced.get(topTopic) ?? 0) / most : 0;
        const s = params.score;
        const score =
          s.topic * preference +
          (parents.length > 0 ? s.similar : 0) +
          fit(candidate.difficulty, reference ?? "Easy") +
          s.jitter * hash(`candidate:${candidate.slug}`);
        const reasons: SuggestionReason[] = [{ code: "general_practice", why }];
        const parent = parents[0];
        if (parent) reasons.push({ code: "similar_to", problemId: parent.id, title: parent.title, category: null });
        else if (topTopic && preference > 0) reasons.push({ code: "topic_match", topic: topTopic });
        return { candidate, score, reasons };
      }),
    )!;
  };

  const plan = (picked: Scored, category: SkillDimension | null): SuggestionPlan => ({
    kind: "suggestion",
    target: {
      slug: picked.candidate.slug,
      title: picked.candidate.title,
      difficulty: picked.candidate.difficulty,
      topicTags: [...picked.candidate.topicTags],
    },
    category,
    lane: category ? "personalized" : "general",
    reasons: picked.reasons,
    plannerVersion: SUGGESTION_PLANNER_VERSION,
  });

  // General practice always has a candidate here, so it is never exhausted
  // and the rotation always ends in a plan.
  while (true) {
    const type = nextType({ deficit, servedToday, exhausted, perDayCap: 1, tieBreak: (type) => hash(`type:${type}`) });
    if (type === null || type === "checkup") {
      const why: GeneralPracticeWhy =
        !input.profile.personalized ? "not_personalized"
        : targets.length === 0 ? "no_focus"
        : exhausted.size > 0 ? "no_targeted_candidate"
        : "rotation";
      return plan(general(why), null);
    }
    const picked = targeted(type);
    if (picked) return plan(picked, type);
    exhausted.add(type);
  }
}

function countBy<T, K>(items: readonly T[], key: (item: T) => K) {
  const counts = new Map<K, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

function best(scored: Scored[]): Scored | null {
  return scored.reduce<Scored | null>((top, entry) => (!top || entry.score > top.score ? entry : top), null);
}

/** `π_d(t)`: the share of a dimension's confirmed contexts on each topic
 *  (a problem's contexts split evenly across its topics). */
function categoryTopicShares(problems: readonly SuggestionProblem[]) {
  const totals = new Map<SkillDimension, Map<string, number>>();
  for (const problem of problems) {
    if (problem.topics.length === 0) continue;
    for (const [category, contexts] of Object.entries(problem.confirmedContexts) as [SkillDimension, number][]) {
      if (!contexts) continue;
      const shares = totals.get(category) ?? new Map<string, number>();
      for (const topic of new Set(problem.topics)) shares.set(topic, (shares.get(topic) ?? 0) + contexts / problem.topics.length);
      totals.set(category, shares);
    }
  }
  for (const shares of totals.values()) {
    const sum = [...shares.values()].reduce((total, value) => total + value, 0);
    for (const [topic, value] of shares) shares.set(topic, value / sum);
  }
  return totals;
}

/** The median difficulty of recent practice, or null without any. */
function typicalDifficulty(difficulties: readonly LeetCodeDifficulty[]): LeetCodeDifficulty | null {
  if (difficulties.length === 0) return null;
  const ranks = difficulties.map((difficulty) => RANK[difficulty]).sort((a, b) => a - b);
  return byRank[ranks[Math.floor((ranks.length - 1) / 2)]!]!;
}
