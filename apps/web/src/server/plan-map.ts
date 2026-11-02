import type { PlanMetersDto, PlanStatusesDto } from "@ankify/contracts";
import { planCatalogProblem, planListSets } from "@ankify/core/plan-catalog";
import { getDb, schema } from "@ankify/db";
import { and, eq } from "drizzle-orm";
import { getCachedLeetcodeAccount, getLeetcodeSolved } from "./leetcode-account";
import { planStatusContext, type AccountForStatus } from "./plan-status";

/**
 * The Plan page's map: manual ticks, every problem's status, and the meters.
 * A tick (`settings` row `plan-ticks`, `{ slugs }`) says "I've done this" for a
 * problem the app can't see otherwise, such as one solved before the extension
 * or a leetcode.cn-only one. Plans count it as solved. It never overrides
 * evidence: a problem solved on LeetCode or in the deck keeps its status when
 * unticked.
 */

const TICKS_KEY = "plan-ticks";

function parseTicks(value: unknown): Set<string> {
  const slugs = (value as { slugs?: unknown } | undefined)?.slugs;
  return new Set(Array.isArray(slugs) ? slugs.filter((slug): slug is string => typeof slug === "string") : []);
}

export async function readPlanTicks(userId: string): Promise<Set<string>> {
  const [row] = await getDb()
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, TICKS_KEY)));
  return parseTicks(row?.value);
}

/** false when the slug isn't on the map. Quick ticks in a row can't lose each
 *  other: the read and write share one write transaction. */
export async function setPlanTick(userId: string, slug: string, done: boolean): Promise<boolean> {
  if (!planCatalogProblem(slug)) return false;
  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, TICKS_KEY)));
    const ticks = parseTicks(row?.value);
    if (done) ticks.add(slug);
    else ticks.delete(slug);
    const value = { slugs: [...ticks] };
    await tx
      .insert(schema.settings)
      .values({ userId, key: TICKS_KEY, value })
      .onConflictDoUpdate({
        target: [schema.settings.userId, schema.settings.key],
        set: { value, updatedAt: new Date() },
      });
  });
  return true;
}

export async function loadPlanStatusContext(userId: string, leetcode: AccountForStatus, now: Date) {
  const [rows, solved, ticks] = await Promise.all([
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
    readPlanTicks(userId),
  ]);
  return planStatusContext({ rows, solved, leetcode, ticks, now });
}

function countDue(entries: PlanStatusesDto["statuses"]): number {
  return Object.values(entries).filter((entry) => entry.status === "due").length;
}

/** Every problem the user has done. Reads the cached LeetCode account only, so
 *  the map never waits on LeetCode. */
export async function loadPlanStatuses(userId: string): Promise<PlanStatusesDto> {
  const context = await loadPlanStatusContext(userId, await getCachedLeetcodeAccount(userId), new Date());
  const statuses = context.entries();
  return { statuses, due: countDue(statuses) };
}

/** Solved of total for each list and for the main union, in the page's server
 *  render. Totals depend on language: English leaves leetcode.cn-only problems
 *  out, as its plans do. */
export async function loadPlanMeters(userId: string, language: "en" | "zh"): Promise<PlanMetersDto> {
  const context = await loadPlanStatusContext(userId, await getCachedLeetcodeAccount(userId), new Date());
  const sets = planListSets(language);
  const meter = (slugs: readonly string[]) => ({
    solved: slugs.filter((slug) => context.statusOf(slug) !== "todo").length,
    total: slugs.length,
  });
  return {
    lists: {
      course: meter(sets.course),
      route: meter(sets.route),
      nc150: meter(sets.nc150),
      nc250: meter(sets.nc250),
      hot100: meter(sets.hot100),
      top150: meter(sets.top150),
    },
    main: meter(sets.main),
    due: countDue(context.entries()),
  };
}
