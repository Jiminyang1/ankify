import { NextResponse } from "next/server";
import { APP_SESSION_COOKIE, appPasswordConfigured, createSessionCookieValue } from "@/lib/app-auth";

function safeNext(value: FormDataEntryValue | string | null) {
  const next = typeof value === "string" ? value : "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/api/")) return "/";
  return next;
}

export async function POST(req: Request) {
  if (!appPasswordConfigured()) {
    return NextResponse.json({ error: "APP_PASSWORD missing" }, { status: 500 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  const input = contentType.includes("application/json")
    ? ((await req.json().catch(() => null)) as { password?: string; next?: string } | null)
    : null;
  const form = input ? null : await req.formData().catch(() => null);
  const password = input?.password ?? form?.get("password");

  if (password !== process.env.APP_PASSWORD) {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", "1");
    url.searchParams.set("next", safeNext(input?.next ?? form?.get("next") ?? null));
    return NextResponse.redirect(url, { status: 303 });
  }

  const url = new URL(safeNext(input?.next ?? form?.get("next") ?? null), req.url);
  const res = NextResponse.redirect(url, { status: 303 });
  res.cookies.set(APP_SESSION_COOKIE, await createSessionCookieValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return res;
}
