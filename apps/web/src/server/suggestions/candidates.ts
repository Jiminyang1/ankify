import type { SimilarQuestionInput } from "@ankify/contracts";
import { schema } from "@ankify/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DbTransaction } from "../practice-sessions/store";
import { MAX_SUGGESTION_CANDIDATES_PER_USER } from "../resource-limits";

/**
 * Records LeetCode's metadata for the similar questions of a problem the user
 * practiced, as read at `now`. Newer metadata replaces older, but a
 * candidate's first source and any topics from it are kept (similar questions
 * carry no topics). New slugs stop at the per-user cap; known ones still
 * refresh.
 */
export async function recordSimilarQuestions(
  tx: DbTransaction,
  userId: string,
  questions: readonly SimilarQuestionInput[],
  now: Date,
) {
  if (questions.length === 0) return;
  const c = schema.suggestionCandidates;
  const unique = [...new Map(questions.map((question) => [question.slug, question])).values()];
  const [[{ count } = { count: 0 }], known] = await Promise.all([
    tx.select({ count: sql<number>`count(*)` }).from(c).where(eq(c.userId, userId)),
    tx
      .select({ slug: c.slug })
      .from(c)
      .where(and(eq(c.userId, userId), inArray(c.slug, unique.map((question) => question.slug)))),
  ]);
  const knownSlugs = new Set(known.map((row) => row.slug));
  let room = MAX_SUGGESTION_CANDIDATES_PER_USER - count;
  const rows = [];
  for (const question of unique) {
    if (!knownSlugs.has(question.slug)) {
      if (room <= 0) continue;
      room -= 1;
    }
    rows.push({
      id: nanoid(12),
      userId,
      slug: question.slug,
      title: question.title,
      difficulty: question.difficulty,
      paidOnly: question.paidOnly,
      source: "similar_question" as const,
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (rows.length === 0) return;
  await tx
    .insert(c)
    .values(rows)
    .onConflictDoUpdate({
      target: [c.userId, c.slug],
      set: {
        title: sql`excluded.title`,
        difficulty: sql`excluded.difficulty`,
        paidOnly: sql`excluded.paid_only`,
        verifiedAt: sql`excluded.verified_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}
