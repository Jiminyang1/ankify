import {
  computeWeaknessProfile,
  deepDivePlanFor,
  planProblemStatus,
  type LeetCodeDifficulty,
  type PlanProblemStatus,
} from "@ankify/core";
import { focusPlanAfter, goDeeperInChapter } from "@ankify/core/patterns";
import { getDb, schema } from "@ankify/db";
import { eq } from "drizzle-orm";
import type { ChapterDeeperDto, LeetcodeAccountDto, PlanFocusDto, PlanNextDto } from "@ankify/contracts";
import { getCachedLeetcodeAccount, getLeetcodeAccount, getLeetcodeSolved } from "./leetcode-account";
import { toPatternRef, toPatternStep, type DoneSet } from "./patterns";
import { planNextFrom } from "./plan-next";
import { findBuiltInStudyPlan, getCurrentStudyPlan, studyPlanSourceUrl } from "./study-plans";
import { loadActiveWeaknesses } from "./weaknesses";

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
  /** Once every problem in the chapter is solved: the next problems on the
   *  ladder of the technique most of them use ("go deeper"). */
  deeper: ChapterDeeperDto | null;
  /** The user's active weak spots on this chapter's problems (Plan page only). */
  mistakes: ChapterMistake[];
};

export type ChapterMistake = {
  id: string;
  category: string;
  /** Custom categories' own name; built-ins are localized on the client. */
  categoryName: string | null;
  detail: string;
  hitCount: number;
  problem: { id: string; title: string; slug: string };
};

/** "Your frequent mistakes" on the Plan page: a mistake type across problems. */
export type FrequentMistake = {
  category: string;
  categoryName: string | null;
  /** Active weak spots of this type, and how often they showed up in all. */
  active: number;
  hits: number;
  problems: { id: string; title: string; chapter: string | null }[];
};

/** Mistake types shown in the Plan page summary. */
const FREQUENT_MISTAKES = 4;

export type ProfileData = Awaited<ReturnType<typeof loadProfile>>;

const emptyCounts = (): Record<PlanProblemStatus, number> => ({ todo: 0, solved: 0, remembered: 0, due: 0 });

type Language = "en" | "zh";
type AccountForStatus = Pick<LeetcodeAccountDto, "username" | "profile"> | null;

/** The profile page: the current plan with every problem's status, each
 *  chapter's weak spots, the user's frequent mistakes, and the linked
 *  LeetCode account. */
export async function loadProfile(userId: string, language: Language) {
  const now = new Date();
  const leetcode = await getLeetcodeAccount(userId);
  const [progress, weaknesses] = await Promise.all([
    loadPlanProgress(userId, language, leetcode, now),
    loadActiveWeaknesses(userId),
  ]);
  const chapterOf = new Map(progress.groups.flatMap((group) => group.items.map((item) => [item.slug, group.name])));
  const groups = progress.groups.map((group) => {
    const slugs = new Set(group.items.map((item) => item.slug));
    return {
      ...group,
      mistakes: weaknesses
        .filter((weakness) => slugs.has(weakness.slug))
        .map(
          (weakness): ChapterMistake => ({
            id: weakness.id,
            category: weakness.category,
            categoryName: weakness.categoryName,
            detail: weakness.detail,
            hitCount: weakness.hitCount,
            problem: { id: weakness.problemId, title: weakness.title, slug: weakness.slug },
          }),
        ),
    };
  });
  const byProblem = new Map(weaknesses.map((weakness) => [weakness.problemId, weakness]));
  const frequentMistakes = computeWeaknessProfile(weaknesses, now)
    .slice(0, FREQUENT_MISTAKES)
    .map(
      (entry): FrequentMistake => ({
        category: entry.category,
        categoryName: weaknesses.find((weakness) => weakness.category === entry.category)?.categoryName ?? null,
        active: entry.active,
        hits: entry.hits,
        problems: entry.problemIds.flatMap((id) => {
          const weakness = byProblem.get(id);
          return weakness ? [{ id, title: weakness.title, chapter: chapterOf.get(weakness.slug) ?? null }] : [];
        }),
      }),
    );
  return {
    ...progress,
    groups,
    frequentMistakes,
    leetcode,
    leetcodeStale:
      leetcode != null &&
      (!leetcode.fetchedAt || now.getTime() - new Date(leetcode.fetchedAt).getTime() > LEETCODE_STALE_MS),
  };
}

/** Today's Next part, on the web and through `/api/study-plan/next` for the
 *  extension. Reads the cached LeetCode account only, so Today never waits
 *  on LeetCode. Once the plan is solved it suggests a focused plan. */
export async function loadPlanNext(userId: string, language: Language): Promise<PlanNextDto> {
  const progress = await loadPlanProgress(userId, language, await getCachedLeetcodeAccount(userId), new Date());
  const next = planNextFrom(progress.plan, progress.groups);
  if (next.next) return next;
  return { ...next, focus: focusAfterPlan(progress, language) };
}

/** After the plan: the plan for the technique the user forgets most
 *  (`focusPlanAfter()`), named in the user's language. */
function focusAfterPlan(
  progress: Pick<Awaited<ReturnType<typeof loadPlanProgress>>, "plan" | "groups" | "deck">,
  language: Language,
): PlanFocusDto | null {
  const focus = focusPlanAfter({
    currentPlan: progress.plan.slug,
    deck: progress.deck.map((row) => ({ slug: row.leetcodeSlug, lapses: row.fsrsLapses })),
    chapters: progress.groups.map((group) => ({
      name: group.name,
      lapses: group.items.reduce((sum, item) => sum + item.lapses, 0),
    })),
  });
  const plan = focus ? findBuiltInStudyPlan(focus.plan, language) : null;
  if (!focus || !plan) return null;
  return {
    slug: plan.slug,
    name: plan.name,
    total: plan.groups.reduce((sum, group) => sum + group.questions.length, 0),
    sourceUrl: studyPlanSourceUrl(plan.slug),
    reason:
      focus.kind === "topic"
        ? { kind: "topic", name: { en: focus.topic.en, zh: focus.topic.zh } }
        : { kind: "chapter", name: focus.chapter },
    lapses: focus.lapses,
  };
}

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

  // Ladders count a problem as done the same way the roadmap does.
  const done: DoneSet = {
    inDeck: new Map(rows.map((row) => [row.leetcodeSlug, row.id])),
    isDone: (slug) => deck.has(slug) || solvedOnLeetcode.has(slug),
  };

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
    const deeper =
      groupCounts.todo === 0
        ? goDeeperInChapter(
            items.map((item) => item.slug),
            done.isDone,
          )
        : null;
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
      deeper: deeper
        ? {
            technique: toPatternRef(deeper.topic, deeper.pattern),
            problems: deeper.steps.map((step) => toPatternStep(step, done)),
          }
        : null,
      mistakes: [],
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
    deck: rows,
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
