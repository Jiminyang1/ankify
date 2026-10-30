import type { SubmissionDto } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { and, desc, eq } from "drizzle-orm";
import { publicSubmissionColumns, toSubmissionDto } from "./public-dto";

/** One review-workspace tab's data, loaded lazily. The docs (Notes,
 *  Solutions) come from /api/problems/:id/docs; this serves the rest. */

type ReviewResourceResult =
  | { ok: true; resource: "submissions"; payload: { submissions: SubmissionDto[] } }
  | { ok: false; error: "invalid_resource" | "problem_not_found" };

export async function loadReviewResource(
  userId: string,
  problemId: string,
  resource: string | null,
): Promise<ReviewResourceResult> {
  if (resource !== "submissions") return { ok: false, error: "invalid_resource" };

  const db = getDb();
  const [problemRows, submissions] = await Promise.all([
    db
      .select({ id: schema.problems.id })
      .from(schema.problems)
      .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)))
      .limit(1),
    db
      .select(publicSubmissionColumns)
      .from(schema.submissions)
      .where(and(eq(schema.submissions.problemId, problemId), eq(schema.submissions.userId, userId)))
      .orderBy(desc(schema.submissions.submittedAt))
      .limit(10),
  ]);
  if (!problemRows[0]) return { ok: false, error: "problem_not_found" };
  return { ok: true, resource, payload: { submissions: submissions.map(toSubmissionDto) } };
}
