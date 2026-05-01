import { NextResponse } from "next/server";
import { getDb, schema } from "@ankify/db";
import { and, desc, eq, lt, ne } from "drizzle-orm";
import { rate, type FsrsCardState, type FsrsRating } from "@ankify/core";
import { getReviewQueueStatus } from "@/lib/review-queue";

const GENERATION_TIMEOUT_MS = 10 * 60 * 1000;

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const db = getDb();

  const [problem] = await db
    .select()
    .from(schema.problems)
    .where(eq(schema.problems.leetcodeSlug, slug));
  if (!problem) {
    return NextResponse.json({ error: "not_captured" }, { status: 404 });
  }

  const stuckBefore = new Date(Date.now() - GENERATION_TIMEOUT_MS);
  await db
    .update(schema.cards)
    .set({ aiStatus: "failed", errorMessage: "timeout: generation did not complete" })
    .where(and(
      eq(schema.cards.problemId, problem.id),
      eq(schema.cards.aiStatus, "generating"),
      lt(schema.cards.createdAt, stuckBefore),
    ));

  const [cards, candidates, queue] = await Promise.all([
    db
      .select()
      .from(schema.cards)
      .where(and(eq(schema.cards.problemId, problem.id), eq(schema.cards.aiStatus, "ready")))
      .orderBy(desc(schema.cards.createdAt)),
    db
      .select()
      .from(schema.cards)
      .where(and(eq(schema.cards.problemId, problem.id), ne(schema.cards.aiStatus, "ready")))
      .orderBy(desc(schema.cards.createdAt)),
    getReviewQueueStatus(db),
  ]);

  const now = new Date();
  const state: FsrsCardState = {
    due: problem.fsrsDue,
    stability: problem.fsrsStability,
    difficulty: problem.fsrsDifficulty,
    elapsedDays: problem.fsrsElapsedDays,
    scheduledDays: problem.fsrsScheduledDays,
    reps: problem.fsrsReps,
    lapses: problem.fsrsLapses,
    state: problem.fsrsState,
    lastReview: problem.fsrsLastReview,
  };

  const previews: Record<FsrsRating, { due: string }> = {
    1: { due: rate(state, 1, now).next.due!.toISOString() },
    2: { due: rate(state, 2, now).next.due!.toISOString() },
    3: { due: rate(state, 3, now).next.due!.toISOString() },
    4: { due: rate(state, 4, now).next.due!.toISOString() },
  };

  return NextResponse.json({ problem, cards, candidates, previews, queue });
}
