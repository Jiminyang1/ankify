import type { CardDto, SubmissionDto } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { and, desc, eq } from "drizzle-orm";
import {
  publicCardColumns,
  publicSubmissionColumns,
  toSubmissionDto,
} from "./public-dto";

type ReviewResourceSuccess =
  | {
      ok: true;
      resource: "cards";
      payload: { cards: CardDto[] };
    }
  | {
      ok: true;
      resource: "submissions";
      payload: { submissions: SubmissionDto[] };
    }
  | { ok: true; resource: "notes"; payload: { notes: string } };

type ReviewResourceFailure = {
  ok: false;
  error: "invalid_resource" | "problem_not_found";
};

type ReviewResourceResult = ReviewResourceSuccess | ReviewResourceFailure;

export async function loadReviewResource(
  userId: string,
  problemId: string,
  resource: string | null,
): Promise<ReviewResourceResult> {
  if (resource !== "cards" && resource !== "submissions" && resource !== "notes") {
    return { ok: false, error: "invalid_resource" };
  }

  const db = getDb();
  const ownedProblem = db
    .select({ id: schema.problems.id })
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)))
    .limit(1);

  if (resource === "cards") {
    const [problemRows, cards] = await Promise.all([
      ownedProblem,
      db
        .select(publicCardColumns)
        .from(schema.cards)
        .where(
          and(
            eq(schema.cards.problemId, problemId),
            eq(schema.cards.userId, userId),
            eq(schema.cards.aiStatus, "ready"),
          ),
        )
        .orderBy(desc(schema.cards.createdAt))
        .limit(50),
    ]);
    if (!problemRows[0]) return { ok: false, error: "problem_not_found" };
    return { ok: true, resource, payload: { cards } };
  }

  if (resource === "submissions") {
    const [problemRows, submissions] = await Promise.all([
      ownedProblem,
      db
        .select(publicSubmissionColumns)
        .from(schema.submissions)
        .where(
          and(
            eq(schema.submissions.problemId, problemId),
            eq(schema.submissions.userId, userId),
          ),
        )
        .orderBy(desc(schema.submissions.submittedAt))
        .limit(10),
    ]);
    if (!problemRows[0]) return { ok: false, error: "problem_not_found" };
    return {
      ok: true,
      resource,
      payload: { submissions: submissions.map(toSubmissionDto) },
    };
  }

  const [problem] = await db
    .select({ notes: schema.problems.notes })
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)))
    .limit(1);
  if (!problem) return { ok: false, error: "problem_not_found" };
  return { ok: true, resource, payload: { notes: problem.notes ?? "" } };
}
