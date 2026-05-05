import { NextResponse } from "next/server";
import { getDb, schema } from "@ankify/db";

/** POST /api/dev/reset
 *  Wipes all user data: review_events → quiz_sessions → cards → submissions → problems.
 *  Settings are preserved (provider/model/api keys).
 *
 *  Hard-guarded: only enabled when NODE_ENV !== "production". Returns 404 in
 *  prod so the route looks like it doesn't exist. */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const db = getDb();

  // Order matters: children first to satisfy FKs even if cascade flags drift.
  await db.delete(schema.reviewEvents);
  await db.delete(schema.quizSessions);
  await db.delete(schema.cards);
  await db.delete(schema.submissions);
  await db.delete(schema.problems);

  console.log("[dev-reset] wiped problems / cards / submissions / quiz_sessions / review_events");
  return NextResponse.json({ ok: true });
}
