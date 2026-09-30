import { makeSignature } from "better-auth/crypto";
import { NextResponse } from "next/server";
import {
  isQaProfile,
  QA_SECOND_SESSION_TOKEN,
  QA_SESSION_MAX_AGE_SECONDS,
  QA_SESSION_TOKEN,
} from "@/server/qa";

export async function GET(req: Request) {
  if (!isQaProfile()) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // `?account=second` signs in to the second, empty QA account.
  const token = new URL(req.url).searchParams.get("account") === "second" ? QA_SECOND_SESSION_TOKEN : QA_SESSION_TOKEN;
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
