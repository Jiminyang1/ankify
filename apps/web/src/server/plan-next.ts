import type { ChapterDeeperDto, PlanNextDto } from "@ankify/contracts";
import type { PlanGroup } from "./profile";

/** Not started, and anyone can open it on either site. leetcode.cn-only and
 *  Premium problems would make Next a dead end for some. */
export function isOpenTodo(item: Pick<PlanGroup["items"][number], "status" | "cnOnly" | "premium">): boolean {
  return item.status === "todo" && !item.cnOnly && !item.premium;
}

/** The plan is ordered, so the next problem is the first open one (`isOpenTodo`),
 *  and its group is the chapter the user is in. Problems that aren't open are
 *  never next, and left over they don't hold a chapter open. */
export function planNextFrom(
  plan: { slug: string; name: string; sourceUrl: string | null; source?: PlanNextDto["plan"]["source"] },
  groups: (Pick<PlanGroup, "name" | "items" | "counts"> & { deeper?: ChapterDeeperDto | null })[],
): PlanNextDto {
  const done = (group: Pick<PlanGroup, "items" | "counts">) => group.items.length - group.counts.todo;
  const summary = {
    slug: plan.slug,
    name: plan.name,
    sourceUrl: plan.sourceUrl,
    source: plan.source,
    done: groups.reduce((sum, group) => sum + done(group), 0),
    total: groups.reduce((sum, group) => sum + group.items.length, 0),
  };
  for (const [index, group] of groups.entries()) {
    const item = group.items.find(isOpenTodo);
    if (!item) continue;
    // The chapter before is finished and this one isn't started: the moment
    // to offer going deeper on what the user just learned.
    const previous = index > 0 ? groups[index - 1]! : null;
    const finishedChapter =
      previous && done(group) === 0 && !previous.items.some(isOpenTodo)
        ? { name: previous.name, deeper: previous.deeper ?? null }
        : null;
    return {
      plan: summary,
      next: {
        chapter: { name: group.name, done: done(group), total: group.items.length },
        problem: { slug: item.slug, leetcodeId: item.leetcodeId, title: item.title, difficulty: item.difficulty },
      },
      finishedChapter,
    };
  }
  return { plan: summary, next: null };
}
