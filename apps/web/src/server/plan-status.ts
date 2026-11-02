import { planProblemStatus, type PlanProblemStatus } from "@ankify/core";
import type { LeetcodeAccountDto, PlanStatusEntryDto } from "@ankify/contracts";
import type { LeetcodeSolved } from "./leetcode-account";

/**
 * One user's status for any problem: the deck, the LeetCode solved list, and
 * ticks made on the Plan page. The plan loaders and the map share this, so a
 * problem reads the same everywhere. Pure, so it's tested without a database.
 */

export type PlanStatusRow = {
  id: string;
  leetcodeSlug: string;
  archivedAt: Date | null;
  fsrsDue: Date | null;
  fsrsLapses: number;
};

export type AccountForStatus = Pick<LeetcodeAccountDto, "site" | "username" | "profile">;

export function planStatusContext(input: {
  rows: readonly PlanStatusRow[];
  solved: readonly LeetcodeSolved[];
  leetcode: readonly AccountForStatus[];
  ticks: ReadonlySet<string>;
  now: Date;
}) {
  const { rows, solved, leetcode, ticks, now } = input;
  const deck = new Map(rows.map((row) => [row.leetcodeSlug, row]));
  // Publicly LeetCode shows only the latest accepted problems; the extension's
  // snapshot adds the full solved list for the linked account. A slug names the
  // same problem on both sites, so either site's solve counts.
  const synced = solved.filter((list) =>
    leetcode.some(
      (account) => account.site === list.site && account.username.toLowerCase() === list.username.toLowerCase(),
    ),
  );
  const syncedSlugs = new Set(synced.flatMap((list) => list.slugs));
  const solvedOnLeetcode = new Set([
    ...leetcode.flatMap((account) => account.profile?.recentAccepted.map((item) => item.slug) ?? []),
    ...syncedSlugs,
  ]);
  const solvedSync =
    synced.length > 0
      ? { count: syncedSlugs.size, syncedAt: synced.map((list) => list.syncedAt).sort().at(-1)! }
      : null;

  const statusOf = (slug: string): PlanProblemStatus => {
    const row = deck.get(slug);
    return planProblemStatus(
      {
        tracked: row ? { due: row.fsrsDue, archived: row.archivedAt != null } : undefined,
        solvedOnLeetcode: solvedOnLeetcode.has(slug),
        ticked: ticks.has(slug),
      },
      now,
    );
  };

  return {
    rows,
    deck,
    solvedOnLeetcode,
    solvedSync,
    ticks,
    statusOf,
    /** Ladders skip these; the same evidence the roadmap counts. */
    isDone: (slug: string) => deck.has(slug) || solvedOnLeetcode.has(slug) || ticks.has(slug),
    /** Every problem with a status other than todo, by slug. */
    entries(): Record<string, PlanStatusEntryDto> {
      const entries: Record<string, PlanStatusEntryDto> = {};
      for (const slug of new Set([...deck.keys(), ...solvedOnLeetcode, ...ticks])) {
        const status = statusOf(slug);
        if (status === "todo") continue;
        const row = deck.get(slug);
        entries[slug] = {
          status,
          ...(row ? { problemId: row.id } : {}),
          ...(ticks.has(slug) ? { ticked: true } : {}),
          ...(row || solvedOnLeetcode.has(slug) ? { auto: true } : {}),
        };
      }
      return entries;
    },
  };
}

export type PlanStatusContext = ReturnType<typeof planStatusContext>;
