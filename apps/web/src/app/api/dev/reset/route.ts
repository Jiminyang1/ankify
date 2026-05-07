import { NextResponse } from "next/server";
import { getDb, schema } from "@ankify/db";
import { eq } from "drizzle-orm";
import { getRequestUser, unauthorizedResponse } from "@/lib/auth";

/** POST /api/dev/reset
 *  Wipes all user data: review_events → quiz_sessions → cards → submissions → problems.
 *  Settings are preserved (provider/model/api keys).
 *
 *  Hard-guarded: only enabled when NODE_ENV !== "production". Returns 404 in
 *  prod so the route looks like it doesn't exist. */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not Found", { status: 404 });
  }
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const db = getDb();

  // Order matters: children first to satisfy FKs even if cascade flags drift.
  await db.delete(schema.reviewEvents).where(eq(schema.reviewEvents.userId, user.id));
  await db.delete(schema.quizSessions).where(eq(schema.quizSessions.userId, user.id));
  await db.delete(schema.cards).where(eq(schema.cards.userId, user.id));
  await db.delete(schema.submissions).where(eq(schema.submissions.userId, user.id));
  await db.delete(schema.problems).where(eq(schema.problems.userId, user.id));

  console.log("[dev-reset] wiped problems / cards / submissions / quiz_sessions / review_events");
  return NextResponse.json({ ok: true });
}
