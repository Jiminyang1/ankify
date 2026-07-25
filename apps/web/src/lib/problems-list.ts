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
import { dueProblemCondition } from "./due-problems";

export const DEFAULT_PROBLEMS_PAGE_SIZE = 50;
export const MAX_PROBLEMS_PAGE_SIZE = 100;

type ProblemsCursor = { createdAt: string; id: string };

export class InvalidProblemsCursorError extends Error {}

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

export type ProblemListItem = {
  id: string;
  leetcodeSlug: string;
  leetcodeId: number | null;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  topicTags: string[];
  fsrsDue: string | null;
  fsrsReps: number;
  fsrsLapses: number;
  fsrsState: "new" | "learning" | "review" | "relearning";
  archivedAt: string | null;
  createdAt: string;
  cardTotal: number;
};

export type ProblemsListPayload = {
  problems: ProblemListItem[];
  dueCount: number;
  serverNow: string;
  totalCount: number;
  nextCursor: string | null;
};

export async function loadProblemsList(
  userId: string,
  options: {
    search?: string;
    archivedOnly?: boolean;
    cursor?: string | null;
    limit?: number;
  } = {},
): Promise<ProblemsListPayload> {
  const db = getDb();
  const now = new Date();
  const search = options.search?.trim() ?? "";
  const archivedOnly = options.archivedOnly ?? false;
  const requestedLimit = options.limit ?? DEFAULT_PROBLEMS_PAGE_SIZE;
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_PROBLEMS_PAGE_SIZE)
    : DEFAULT_PROBLEMS_PAGE_SIZE;
  const cursorParam = options.cursor ?? null;
  const cursor = decodeCursor(cursorParam);
  if (cursorParam && !cursor) throw new InvalidProblemsCursorError();

  const baseConditions = [
    eq(schema.problems.userId, userId),
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
      .where(dueProblemCondition(userId, now)),
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
              eq(schema.cards.userId, userId),
              eq(schema.cards.aiStatus, "ready"),
              inArray(schema.cards.problemId, problemIds),
            ),
          )
          .groupBy(schema.cards.problemId);

  const cardByProblem = new Map(cardStats.map((row) => [row.problemId, row.total]));
  const lastProblem = problems.at(-1);

  return {
    problems: problems.map((problem) => ({
      ...problem,
      fsrsDue: problem.fsrsDue?.toISOString() ?? null,
      archivedAt: problem.archivedAt?.toISOString() ?? null,
      createdAt: problem.createdAt.toISOString(),
      cardTotal: cardByProblem.get(problem.id) ?? 0,
    })),
    dueCount: dueRow?.count ?? 0,
    serverNow: now.toISOString(),
    totalCount: totalRow?.count ?? 0,
    nextCursor:
      hasMore && lastProblem
        ? encodeCursor(lastProblem.createdAt, lastProblem.id)
        : null,
  };
}
