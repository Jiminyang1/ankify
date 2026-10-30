import type { ChapterDeeperDto, PlanNextDto } from "@ankify/contracts";
import type { PlanGroup } from "./profile";

/** The plan is ordered, so the next problem is the first one not started,
 *  and its group is the chapter the user is in. */
export function planNextFrom(
  plan: { slug: string; name: string; sourceUrl: string | null },
  groups: (Pick<PlanGroup, "name" | "items" | "counts"> & { deeper?: ChapterDeeperDto | null })[],
): PlanNextDto {
  const done = (group: Pick<PlanGroup, "items" | "counts">) => group.items.length - group.counts.todo;
  const summary = {
    slug: plan.slug,
    name: plan.name,
    sourceUrl: plan.sourceUrl,
    done: groups.reduce((sum, group) => sum + done(group), 0),
    total: groups.reduce((sum, group) => sum + group.items.length, 0),
  };
  for (const [index, group] of groups.entries()) {
    const item = group.items.find((candidate) => candidate.status === "todo");
    if (!item) continue;
    // The chapter before is finished and this one isn't started: the moment
    // to offer going deeper on what the user just learned.
    const previous = index > 0 ? groups[index - 1]! : null;
    const finishedChapter =
      previous && done(group) === 0 && previous.counts.todo === 0
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
