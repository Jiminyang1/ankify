import { getDb, schema } from "@ankify/db";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/safe-next";
import {
  isQaProfile,
  QA_SECOND_SESSION_ID,
  QA_SECOND_SESSION_TOKEN,
  QA_SECOND_USER_ID,
  QA_SESSION_ID,
  QA_SESSION_MAX_AGE_SECONDS,
  QA_SESSION_TOKEN,
  QA_USER_ID,
} from "@/server/qa";

export async function GET(req: Request) {
  if (!isQaProfile()) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // `?account=second` signs in to the second, empty QA account.
  const url = new URL(req.url);
  const second = url.searchParams.get("account") === "second";
  const account = second
    ? { sessionId: QA_SECOND_SESSION_ID, userId: QA_SECOND_USER_ID, token: QA_SECOND_SESSION_TOKEN }
    : { sessionId: QA_SESSION_ID, userId: QA_USER_ID, token: QA_SESSION_TOKEN };

  // Signing out on the web deletes the seeded session row; put it back so a
  // QA or demo account can sign in again without reseeding.
  const db = getDb();
  const [user] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, account.userId)).limit(1);
  if (!user) {
    return new NextResponse("The QA account is missing. Run `pnpm qa:reset` (or restart `pnpm dev:qa` / `pnpm dev:demo`).", { status: 409 });
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + QA_SESSION_MAX_AGE_SECONDS * 1000);
  await db
    .insert(schema.session)
    .values({ id: account.sessionId, userId: account.userId, token: account.token, expiresAt, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: schema.session.id, set: { userId: account.userId, token: account.token, expiresAt, updatedAt: now } });

  const signature = await makeSignature(account.token, process.env.BETTER_AUTH_SECRET!);
  const response = NextResponse.redirect(new URL(safeNextPath(url.searchParams.get("next")), req.url));
  response.cookies.set(
    "better-auth.session_token",
    `${account.token}.${signature}`,
    {
      httpOnly: true,
      maxAge: QA_SESSION_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: false,
    },
  );
  response.cookies.delete("better-auth.session_data");
  return response;
}
