import { NextResponse } from "next/server";
import { getDb, schema } from "@ankify/db";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { getRequestUser, unauthorizedResponse } from "@/lib/auth";
import { dueProblemCondition } from "@/lib/due-problems";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

type ProblemsCursor = { createdAt: string; id: string };

function decodeCursor(value: string | null): { createdAt: Date; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as ProblemsCursor;
    const createdAt = new Date(parsed.createdAt);
    if (!parsed.id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

function encodeCursor(createdAt: Date, id: string) {
  return Buffer.from(
    JSON.stringify({ createdAt: createdAt.toISOString(), id } satisfies ProblemsCursor),
  ).toString("base64url");
}

/** GET /api/problems?search=&archived=1&cursor=&limit= — paginated
 *  metadata-only problem list with card counts.
 *  Default lists non-archived; `archived=1` lists archived problems instead. */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const db = getDb();
  const now = new Date();
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim() ?? "";
  const archivedOnly = searchParams.get("archived") === "1";
  const requestedLimit = Number(searchParams.get("limit") ?? DEFAULT_PAGE_SIZE);
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  const cursorParam = searchParams.get("cursor");
  const cursor = decodeCursor(cursorParam);
  if (cursorParam && !cursor) {
    return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }

  const baseConditions = [
    eq(schema.problems.userId, user.id),
    archivedOnly ? isNotNull(schema.problems.archivedAt) : isNull(schema.problems.archivedAt),
  ];
  if (search) baseConditions.push(like(schema.problems.title, `%${search}%`));

  const cursorCondition = cursor
    ? or(
        lt(schema.problems.createdAt, cursor.createdAt),
        and(
          eq(schema.problems.createdAt, cursor.createdAt),
          lt(schema.problems.id, cursor.id),
        ),
      )
    : undefined;

  const [problemRows, [totalRow], [dueRow]] = await Promise.all([
    db
      .select({
        id: schema.problems.id,
        leetcodeSlug: schema.problems.leetcodeSlug,
        leetcodeId: schema.problems.leetcodeId,
        title: schema.problems.title,
        difficulty: schema.problems.difficulty,
        topicTags: schema.problems.topicTags,
        fsrsDue: schema.problems.fsrsDue,
        fsrsReps: schema.problems.fsrsReps,
        fsrsLapses: schema.problems.fsrsLapses,
        fsrsState: schema.problems.fsrsState,
        archivedAt: schema.problems.archivedAt,
        createdAt: schema.problems.createdAt,
      })
      .from(schema.problems)
      .where(and(...baseConditions, cursorCondition))
      .orderBy(desc(schema.problems.createdAt), desc(schema.problems.id))
      .limit(limit + 1),
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.problems)
      .where(and(...baseConditions)),
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.problems)
      .where(dueProblemCondition(user.id, now)),
  ]);

  const hasMore = problemRows.length > limit;
  const problems = hasMore ? problemRows.slice(0, limit) : problemRows;
  const problemIds = problems.map((problem) => problem.id);

  const cardStats =
    problemIds.length === 0
      ? []
      : await db
          .select({
            problemId: schema.cards.problemId,
            total: sql<number>`count(*)`,
          })
          .from(schema.cards)
          .where(
            and(
              eq(schema.cards.userId, user.id),
              eq(schema.cards.aiStatus, "ready"),
              inArray(schema.cards.problemId, problemIds),
            ),
          )
          .groupBy(schema.cards.problemId);

  const cardByProblem = new Map(
    cardStats.map((m) => [
      m.problemId,
      {
        total: m.total,
      },
    ]),
  );

  const lastProblem = problems.at(-1);

  return NextResponse.json({
    problems: problems.map((p) => {
      const stats = cardByProblem.get(p.id);
      return {
        ...p,
        cardTotal: stats?.total ?? 0,
      };
    }),
    dueCount: dueRow?.count ?? 0,
    serverNow: now.toISOString(),
    totalCount: totalRow?.count ?? 0,
    nextCursor:
      hasMore && lastProblem
        ? encodeCursor(lastProblem.createdAt, lastProblem.id)
        : null,
  });
}
