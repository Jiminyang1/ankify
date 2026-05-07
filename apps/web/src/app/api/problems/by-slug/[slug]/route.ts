import { NextResponse } from "next/server";
import { getDb, schema } from "@ankify/db";
import { and, desc, eq, ne } from "drizzle-orm";
import { preview, type FsrsCardState } from "@ankify/core";
import { getRequestUser, unauthorizedResponse } from "@/lib/auth";
import { getReviewQueueStatus } from "@/lib/review-queue";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { slug } = await ctx.params;
  const db = getDb();

  const [problem] = await db
    .select()
    .from(schema.problems)
    .where(and(eq(schema.problems.userId, user.id), eq(schema.problems.leetcodeSlug, slug)));
  if (!problem) {
    return NextResponse.json({ error: "not_captured" }, { status: 404 });
  }

  const [cards, candidates, queue] = await Promise.all([
    db
      .select()
      .from(schema.cards)
      .where(and(eq(schema.cards.userId, user.id), eq(schema.cards.problemId, problem.id), eq(schema.cards.aiStatus, "ready")))
      .orderBy(desc(schema.cards.createdAt)),
    db
      .select()
      .from(schema.cards)
      .where(and(eq(schema.cards.userId, user.id), eq(schema.cards.problemId, problem.id), ne(schema.cards.aiStatus, "ready")))
      .orderBy(desc(schema.cards.createdAt)),
    getReviewQueueStatus(user.id, db),
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

  const previews = preview(state, now);

  return NextResponse.json({ problem, cards, candidates, previews, queue });
}
