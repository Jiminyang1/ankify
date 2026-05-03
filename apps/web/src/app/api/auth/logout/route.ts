import { NextResponse } from "next/server";
import { APP_SESSION_COOKIE } from "@/lib/app-auth";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  res.cookies.delete(APP_SESSION_COOKIE);
  return res;
}
