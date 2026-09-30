import {
  STUDY_PLANS,
  getStudyPlan,
  planProblemStatus,
  retrievability,
  type FsrsCardState,
  type LeetCodeDifficulty,
  type PlanProblemStatus,
} from "@ankify/core";
import { getDb, schema } from "@ankify/db";
import { eq } from "drizzle-orm";
import { getLeetcodeAccount, getLeetcodeSolved } from "@/server/leetcode-account";
import { getStudyPlanSlug } from "@/server/settings";

/** getLeetcodeAccount refetches after 12h; a cache older than this means
 *  refreshes are failing and the numbers may be out of date. */
const LEETCODE_STALE_MS = 24 * 60 * 60 * 1000;

export type PlanItem = {
  slug: string;
  title: string;
  difficulty: LeetCodeDifficulty;
  leetcodeId: number;
  status: PlanProblemStatus;
  /** Set when the problem is in the user's deck. */
  problemId: string | null;
  archived: boolean;
  /** 0–1 current recall for reviewed deck problems. */
  recall: number | null;
  due: string | null;
  /** In the deck, not archived, and due for review now. */
  dueNow: boolean;
};

export type PlanGroup = {
  name: string;
  items: PlanItem[];
  /** Items with any evidence of being solved (everything but `todo`). */
  done: number;
};

export type ProfileData = Awaited<ReturnType<typeof loadProfile>>;

export async function loadProfile(userId: string) {
  const now = new Date();
  const [rows, leetcode, solved, planSlug] = await Promise.all([
    getDb()
      .select({
        id: schema.problems.id,
        leetcodeSlug: schema.problems.leetcodeSlug,
        archivedAt: schema.problems.archivedAt,
        fsrsDue: schema.problems.fsrsDue,
        fsrsStability: schema.problems.fsrsStability,
        fsrsDifficulty: schema.problems.fsrsDifficulty,
        fsrsElapsedDays: schema.problems.fsrsElapsedDays,
        fsrsScheduledDays: schema.problems.fsrsScheduledDays,
        fsrsLearningSteps: schema.problems.fsrsLearningSteps,
        fsrsReps: schema.problems.fsrsReps,
        fsrsLapses: schema.problems.fsrsLapses,
        fsrsState: schema.problems.fsrsState,
        fsrsLastReview: schema.problems.fsrsLastReview,
      })
      .from(schema.problems)
      .where(eq(schema.problems.userId, userId)),
    getLeetcodeAccount(userId),
    getLeetcodeSolved(userId),
    getStudyPlanSlug(userId),
  ]);

  const plan = getStudyPlan(planSlug);
  const deck = new Map(rows.map((row) => [row.leetcodeSlug, row]));
  // Publicly LeetCode shows only the latest 20 accepted problems; the
  // extension's snapshot adds the full solved list for the linked account.
  const solvedSync =
    solved && leetcode && solved.username.toLowerCase() === leetcode.username.toLowerCase() ? solved : null;
  const solvedOnLeetcode = new Set([
    ...(leetcode?.profile?.recentAccepted.map((item) => item.slug) ?? []),
    ...(solvedSync?.slugs ?? []),
  ]);

  const groups: PlanGroup[] = plan.groups.map((group) => {
    const items = group.questions.map((question): PlanItem => {
      const row = deck.get(question.slug);
      const fsrs: FsrsCardState | null = row
        ? {
            due: row.fsrsDue,
            stability: row.fsrsStability,
            difficulty: row.fsrsDifficulty,
            elapsedDays: row.fsrsElapsedDays,
            scheduledDays: row.fsrsScheduledDays,
            learningSteps: row.fsrsLearningSteps,
            reps: row.fsrsReps,
            lapses: row.fsrsLapses,
            state: row.fsrsState,
            lastReview: row.fsrsLastReview,
          }
        : null;
      const archived = row?.archivedAt != null;
      return {
        slug: question.slug,
        title: question.title,
        difficulty: question.difficulty,
        leetcodeId: question.id,
        status: planProblemStatus(
          {
            tracked: fsrs ? { fsrs, archived } : undefined,
            solvedOnLeetcode: solvedOnLeetcode.has(question.slug),
          },
          now,
        ),
        problemId: row?.id ?? null,
        archived,
        recall: fsrs && fsrs.reps > 0 ? retrievability(fsrs, now) : null,
        due: row?.fsrsDue?.toISOString() ?? null,
        dueNow: row != null && !archived && (row.fsrsDue == null || row.fsrsDue <= now),
      };
    });
    return { name: group.name, items, done: items.filter((item) => item.status !== "todo").length };
  });

  const items = groups.flatMap((group) => group.items);
  const counts: Record<PlanProblemStatus, number> = { mastered: 0, learning: 0, fading: 0, solved: 0, todo: 0 };
  for (const item of items) counts[item.status] += 1;

  // The plan is ordered, so the current stage is the first group with
  // something left to start, and the next problem is its first untouched one.
  const currentIndex = groups.findIndex((group) => group.done < group.items.length);
  const next = currentIndex >= 0 ? groups[currentIndex]!.items.find((item) => item.status === "todo")! : null;
  const fading = items
    .filter((item) => item.status === "fading")
    .sort((a, b) => (a.recall ?? 0) - (b.recall ?? 0));

  return {
    plan: { slug: plan.slug, name: plan.name },
    plans: STUDY_PLANS.map((option) => ({ slug: option.slug, name: option.name })),
    groups,
    counts,
    total: items.length,
    currentIndex,
    next,
    fading,
    leetcode,
    solvedSync: solvedSync ? { count: solvedSync.slugs.length, syncedAt: solvedSync.syncedAt } : null,
    leetcodeStale:
      leetcode != null &&
      (!leetcode.fetchedAt || now.getTime() - new Date(leetcode.fetchedAt).getTime() > LEETCODE_STALE_MS),
  };
}
