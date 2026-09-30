import { makeSignature } from "better-auth/crypto";
import { getDb, schema } from "@ankify/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  isQaProfile,
  QA_FRESH_SESSION_ID,
  QA_FRESH_SESSION_TOKEN,
  QA_FRESH_USER_EMAIL,
  QA_FRESH_USER_ID,
  QA_SESSION_MAX_AGE_SECONDS,
  QA_SESSION_TOKEN,
} from "@/server/qa";

/** Recreate the fresh QA account from scratch; the user row cascades to
 *  every problem, setting, and session it owned. */
async function resetFreshUser() {
  const now = new Date();
  await getDb().transaction(async (tx) => {
    await tx.delete(schema.user).where(eq(schema.user.id, QA_FRESH_USER_ID));
    await tx.insert(schema.user).values({
      id: QA_FRESH_USER_ID,
      name: "Fresh Tester",
      email: QA_FRESH_USER_EMAIL,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(schema.session).values({
      id: QA_FRESH_SESSION_ID,
      userId: QA_FRESH_USER_ID,
      token: QA_FRESH_SESSION_TOKEN,
      expiresAt: new Date(now.getTime() + QA_SESSION_MAX_AGE_SECONDS * 1000),
      createdAt: now,
      updatedAt: now,
    });
  });
}

/** QA-only sign-in. `?as=fresh` signs in as a brand-new, empty account. */
export async function GET(req: Request) {
  if (!isQaProfile()) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const fresh = new URL(req.url).searchParams.get("as") === "fresh";
  if (fresh) await resetFreshUser();
  const token = fresh ? QA_FRESH_SESSION_TOKEN : QA_SESSION_TOKEN;

  const signature = await makeSignature(token, process.env.BETTER_AUTH_SECRET!);
  const response = NextResponse.redirect(new URL("/today", req.url));
  response.cookies.set(
    "better-auth.session_token",
    `${token}.${signature}`,
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
