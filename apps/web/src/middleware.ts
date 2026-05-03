import { NextResponse, type NextRequest } from "next/server";
import { APP_SESSION_COOKIE, appPasswordConfigured, verifySessionCookieValue } from "@/lib/app-auth";

/**
 * Auth gate for the single-user app.
 *
 * Rule:
 *   - The web UI must have a signed app-password session cookie.
 *   - The Chrome extension can call API routes with `x-ankify-token`.
 *   - In production, a missing `ANKIFY_API_TOKEN` env var is fail-closed.
 *   - In production, a missing `APP_PASSWORD` env var is fail-closed.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isAuthRoute = pathname === "/login" || pathname.startsWith("/api/auth/");

  if (isAuthRoute) return NextResponse.next();

  if (!appPasswordConfigured()) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("server misconfigured: APP_PASSWORD missing", {
      status: 500,
    });
  }

  const expectedToken = process.env.ANKIFY_API_TOKEN;
  if (isApi && !expectedToken && process.env.NODE_ENV === "production") {
    return new NextResponse("server misconfigured: ANKIFY_API_TOKEN missing", {
      status: 500,
    });
  }

  const gotToken = req.headers.get("x-ankify-token");
  if (isApi && expectedToken && gotToken === expectedToken) {
    return NextResponse.next();
  }

  const hasSession = await verifySessionCookieValue(req.cookies.get(APP_SESSION_COOKIE)?.value);
  if (hasSession) {
    return NextResponse.next();
  }

  if (isApi) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.json|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map)$).*)",
  ],
};
