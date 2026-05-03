import { NextResponse } from "next/server";
import { getDb, schema } from "@ankify/db";
import { and, desc, eq, isNull, like, sql } from "drizzle-orm";
import { dueProblemCondition } from "@/lib/due-problems";

/** GET /api/problems?search= — list all problems with card counts, optional title search */
export async function GET(req: Request) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim() ?? "";

  const conditions = [isNull(schema.problems.archivedAt)];
  if (search) conditions.push(like(schema.problems.title, `%${search}%`));

  const problems = await db
    .select()
    .from(schema.problems)
    .where(and(...conditions))
    .orderBy(desc(schema.problems.createdAt))
    .limit(200);

  const cardStats = await db
    .select({
      problemId: schema.cards.problemId,
      total: sql<number>`count(*)`,
    })
    .from(schema.cards)
    .where(eq(schema.cards.aiStatus, "ready"))
    .groupBy(schema.cards.problemId);

  const cardByProblem = new Map(
    cardStats.map((m) => [
      m.problemId,
      {
        total: m.total,
      },
    ]),
  );

  const [dueRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.problems)
    .where(dueProblemCondition(new Date()));

  return NextResponse.json({
    problems: problems.map((p) => {
      const stats = cardByProblem.get(p.id);
      return {
        ...p,
        cardTotal: stats?.total ?? 0,
      };
    }),
    dueCount: dueRow?.count ?? 0,
  });
}
