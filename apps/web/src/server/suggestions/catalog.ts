import { difficultyEnum, leetcodeSlugSchema } from "@ankify/contracts";
import { z } from "zod";
import committed from "./catalog.json";

/**
 * A small committed catalog of free Easy and Medium problems for users with
 * no other candidates. It is generated from LeetCode's own problem list by
 * `scripts/leetcode-catalog.js` (never written by hand or by a model) and is
 * empty until then: an entry without a generation time is unverified and
 * never suggested.
 */
const catalogSchema = z
  .object({
    generatedAt: z.string().datetime().nullable(),
    /** The selection rule the generator applied, recorded with its output. */
    rule: z.string().max(500).nullable(),
    entries: z
      .array(
        z
          .object({
            slug: leetcodeSlugSchema,
            title: z.string().min(1).max(512),
            difficulty: difficultyEnum.exclude(["Hard"]),
            topicTags: z.array(z.string().min(1).max(64)).max(64),
          })
          .strict(),
      )
      .max(2_000),
  })
  .strict();

export type CatalogCandidate = {
  slug: string;
  title: string;
  difficulty: "Easy" | "Medium";
  paidOnly: false;
  topicTags: string[];
  source: "catalog";
  verifiedAt: Date;
};

export function parseCatalog(raw: unknown): CatalogCandidate[] {
  const catalog = catalogSchema.parse(raw);
  if (!catalog.generatedAt) return [];
  const verifiedAt = new Date(catalog.generatedAt);
  const seen = new Set<string>();
  return catalog.entries.flatMap((entry) => {
    if (seen.has(entry.slug)) return [];
    seen.add(entry.slug);
    return [{ ...entry, paidOnly: false as const, source: "catalog" as const, verifiedAt }];
  });
}

let cached: CatalogCandidate[] | null = null;

/** The committed catalog's candidates (none until it has been generated). */
export function catalogCandidates(): readonly CatalogCandidate[] {
  cached ??= parseCatalog(committed);
  return cached;
}
