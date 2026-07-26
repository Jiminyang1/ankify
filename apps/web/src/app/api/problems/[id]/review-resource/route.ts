import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@ankify/db";
import { getRequestUser, unauthorizedResponse } from "@/lib/auth";

const REVIEW_RESOURCES = new Set(["cards", "submissions", "notes"]);

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { id: problemId } = await ctx.params;
  const resource = new URL(req.url).searchParams.get("resource");
  if (!resource || !REVIEW_RESOURCES.has(resource)) {
    return NextResponse.json({ error: "invalid_resource" }, { status: 400 });
  }

  const db = getDb();
  const ownedProblem = db
    .select({ id: schema.problems.id })
    .from(schema.problems)
    .where(
      and(
        eq(schema.problems.id, problemId),
        eq(schema.problems.userId, user.id),
      ),
    )
    .limit(1);

  if (resource === "cards") {
    const [problemRows, cards] = await Promise.all([
      ownedProblem,
      db
        .select()
        .from(schema.cards)
        .where(
          and(
            eq(schema.cards.problemId, problemId),
            eq(schema.cards.userId, user.id),
            eq(schema.cards.aiStatus, "ready"),
          ),
        )
        .orderBy(desc(schema.cards.createdAt))
        .limit(50),
    ]);
    if (!problemRows[0]) {
      return NextResponse.json({ error: "problem_not_found" }, { status: 404 });
    }
    return NextResponse.json(
      { cards },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  if (resource === "submissions") {
    const [problemRows, submissions] = await Promise.all([
      ownedProblem,
      db
        .select()
        .from(schema.submissions)
        .where(
          and(
            eq(schema.submissions.problemId, problemId),
            eq(schema.submissions.userId, user.id),
          ),
        )
        .orderBy(desc(schema.submissions.submittedAt))
        .limit(10),
    ]);
    if (!problemRows[0]) {
      return NextResponse.json({ error: "problem_not_found" }, { status: 404 });
    }
    return NextResponse.json(
      { submissions },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const [problem] = await db
    .select({
      id: schema.problems.id,
      notes: schema.problems.notes,
    })
    .from(schema.problems)
    .where(
      and(
        eq(schema.problems.id, problemId),
        eq(schema.problems.userId, user.id),
      ),
    )
    .limit(1);
  if (!problem) {
    return NextResponse.json({ error: "problem_not_found" }, { status: 404 });
  }
  return NextResponse.json(
    { notes: problem.notes ?? "" },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
