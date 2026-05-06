import { NextResponse } from "next/server";
import { getDb, schema } from "@ankify/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { dueProblemCondition } from "@/lib/due-problems";
import { getReviewQueueStatus } from "@/lib/review-queue";

/** GET /api/review/queue?limit=20 — today's due problem list + queue stats. */
export async function GET(req: Request) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const requested = Number(searchParams.get("limit") ?? "20");
  const cap = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 100) : 20;

  const queue = await getReviewQueueStatus(db);
  const now = new Date();
  const limit = Math.min(cap, queue.remaining);

  if (limit <= 0) {
    return NextResponse.json({ queue, problems: [] });
  }

  const dueProblems = await db
    .select({
      id: schema.problems.id,
      leetcodeSlug: schema.problems.leetcodeSlug,
      title: schema.problems.title,
      difficulty: schema.problems.difficulty,
      url: schema.problems.url,
      fsrsState: schema.problems.fsrsState,
      fsrsDue: schema.problems.fsrsDue,
      fsrsStability: schema.problems.fsrsStability,
      fsrsReps: schema.problems.fsrsReps,
      fsrsLapses: schema.problems.fsrsLapses,
    })
    .from(schema.problems)
    .where(dueProblemCondition(now))
    .orderBy(asc(sql`COALESCE(${schema.problems.fsrsDue}, 0)`))
    .limit(limit);

  const ids = dueProblems.map((p) => p.id);
  const cardCounts = ids.length
    ? await db
        .select({
          problemId: schema.cards.problemId,
          total: sql<number>`count(*)`,
        })
        .from(schema.cards)
        .where(and(eq(schema.cards.aiStatus, "ready"), inArray(schema.cards.problemId, ids)))
        .groupBy(schema.cards.problemId)
    : [];

  const cardCountByProblem = new Map(cardCounts.map((c) => [c.problemId, c.total]));

  return NextResponse.json({
    queue,
    problems: dueProblems.map((p) => ({
      ...p,
      fsrsDue: p.fsrsDue ? p.fsrsDue.toISOString() : null,
      cardCount: cardCountByProblem.get(p.id) ?? 0,
    })),
  });
}
