import {
  deepDivePlanFor,
  planProblemStatus,
  type LeetCodeDifficulty,
  type PlanProblemStatus,
} from "@ankify/core";
import { getDb, schema } from "@ankify/db";
import { eq } from "drizzle-orm";
import type { LeetcodeAccountDto } from "@ankify/contracts";
import { getCachedLeetcodeAccount, getLeetcodeAccount, getLeetcodeSolved } from "@/server/leetcode-account";
import { findBuiltInStudyPlan, getCurrentStudyPlan, studyPlanSourceUrl } from "@/server/study-plans";

/** getLeetcodeAccount refetches after 12h; a cache older than this means
 *  refreshes are failing and the numbers may be out of date. */
const LEETCODE_STALE_MS = 24 * 60 * 60 * 1000;

export type PlanItem = {
  slug: string;
  title: string;
  difficulty: LeetCodeDifficulty;
  leetcodeId: number;
  status: PlanProblemStatus;
  /** Set when the problem is in the user's deck (including archived). */
  problemId: string | null;
  archived: boolean;
  due: string | null;
  /** Times the user forgot it after learning it (FSRS lapses); 0 outside the deck. */
  lapses: number;
};

export type PlanGroup = {
  name: string;
  items: PlanItem[];
  counts: Record<PlanProblemStatus, number>;
  /** LeetCode's topic plan that goes deeper on this pattern, if any. */
  deepDive: { slug: string; name: string; total: number } | null;
};

export type ProfileData = Awaited<ReturnType<typeof loadProfile>>;

const emptyCounts = (): Record<PlanProblemStatus, number> => ({ todo: 0, solved: 0, remembered: 0, due: 0 });

type Language = "en" | "zh";
type AccountForStatus = Pick<LeetcodeAccountDto, "username" | "profile"> | null;

/** The profile page: the current plan with every problem's status, and the
 *  linked LeetCode account. */
export async function loadProfile(userId: string, language: Language) {
  const now = new Date();
  const leetcode = await getLeetcodeAccount(userId);
  return {
    ...(await loadPlanProgress(userId, language, leetcode, now)),
    leetcode,
    leetcodeStale:
      leetcode != null &&
      (!leetcode.fetchedAt || now.getTime() - new Date(leetcode.fetchedAt).getTime() > LEETCODE_STALE_MS),
  };
}

/** The current plan's next problem and the group it's in, for Today. Reads
 *  the cached LeetCode account only, so Today never waits on LeetCode. */
export async function loadPlanNext(userId: string, language: Language) {
  const progress = await loadPlanProgress(userId, language, await getCachedLeetcodeAccount(userId), new Date());
  if (!progress.next) return null;
  const group = progress.groups.find((candidate) => candidate.items.includes(progress.next!))!;
  return {
    plan: progress.plan,
    group: { name: group.name, done: group.items.length - group.counts.todo, total: group.items.length },
    problem: progress.next,
  };
}

export type PlanNext = NonNullable<Awaited<ReturnType<typeof loadPlanNext>>>;

async function loadPlanProgress(userId: string, language: Language, leetcode: AccountForStatus, now: Date) {
  const [rows, solved, current] = await Promise.all([
    getDb()
      .select({
        id: schema.problems.id,
        leetcodeSlug: schema.problems.leetcodeSlug,
        archivedAt: schema.problems.archivedAt,
        fsrsDue: schema.problems.fsrsDue,
        fsrsLapses: schema.problems.fsrsLapses,
      })
      .from(schema.problems)
      .where(eq(schema.problems.userId, userId)),
    getLeetcodeSolved(userId),
    getCurrentStudyPlan(userId, language),
  ]);
  const plan = current.plan;
  const sourceUrl = studyPlanSourceUrl(plan.slug);

  const deck = new Map(rows.map((row) => [row.leetcodeSlug, row]));
  // Publicly LeetCode shows only the latest 20 accepted problems; the
  // extension's snapshot adds the full solved list for the linked account.
  const solvedSync =
    solved && leetcode && solved.username.toLowerCase() === leetcode.username.toLowerCase() ? solved : null;
  const solvedOnLeetcode = new Set([
    ...(leetcode?.profile?.recentAccepted.map((item) => item.slug) ?? []),
    ...(solvedSync?.slugs ?? []),
  ]);

  const counts = emptyCounts();
  const groups: PlanGroup[] = plan.groups.map((group) => {
    const groupCounts = emptyCounts();
    const items = group.questions.map((question): PlanItem => {
      const row = deck.get(question.slug);
      const archived = row?.archivedAt != null;
      const status = planProblemStatus(
        {
          tracked: row ? { due: row.fsrsDue, archived } : undefined,
          solvedOnLeetcode: solvedOnLeetcode.has(question.slug),
        },
        now,
      );
      groupCounts[status] += 1;
      counts[status] += 1;
      return {
        slug: question.slug,
        title: question.title,
        difficulty: question.difficulty,
        leetcodeId: question.id,
        status,
        problemId: row?.id ?? null,
        archived,
        due: row?.fsrsDue?.toISOString() ?? null,
        lapses: row?.fsrsLapses ?? 0,
      };
    });
    // A plan that names its deep dives (the Beginner Route) uses those;
    // 灵茶山艾府's topic lists already are the deep dive.
    const dive = group.deepDive
      ? findBuiltInStudyPlan(group.deepDive, language)
      : sourceUrl
        ? null
        : deepDivePlanFor(group.name, plan.slug);
    return {
      name: group.name,
      items,
      counts: groupCounts,
      deepDive: dive
        ? {
            slug: dive.slug,
            name: dive.name,
            total: dive.groups.reduce((sum, diveGroup) => sum + diveGroup.questions.length, 0),
          }
        : null,
    };
  });

  // The plan is ordered, so the next problem is the first unsolved one.
  const next = groups.flatMap((group) => group.items).find((item) => item.status === "todo") ?? null;

  return {
    plan: { slug: plan.slug, name: plan.name, custom: current.custom, sourceUrl },
    plans: current.options,
    groups,
    counts,
    total: groups.reduce((sum, group) => sum + group.items.length, 0),
    next,
    solvedSync: solvedSync ? { count: solvedSync.slugs.length, syncedAt: solvedSync.syncedAt } : null,
  };
}

/** How much of the current plan the extension's solved list covers, for the
 *  Today onboarding step. null until the extension has synced something. */
export async function loadSolvedSummary(userId: string, language: Language) {
  const [solved, current] = await Promise.all([getLeetcodeSolved(userId), getCurrentStudyPlan(userId, language)]);
  if (!solved || solved.slugs.length === 0) return null;
  const solvedSlugs = new Set(solved.slugs);
  const planSlugs = current.plan.groups.flatMap((group) => group.questions.map((question) => question.slug));
  return {
    solved: solvedSlugs.size,
    planName: current.plan.name,
    planSolved: planSlugs.filter((slug) => solvedSlugs.has(slug)).length,
    planTotal: planSlugs.length,
  };
}

export type SolvedSummary = NonNullable<Awaited<ReturnType<typeof loadSolvedSummary>>>;
