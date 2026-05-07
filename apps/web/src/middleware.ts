import { NextResponse, type NextRequest } from "next/server";

/**
 * Lightweight gate only. API routes and server pages validate the Better Auth
 * session/API key again before touching data.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isAuthRoute = pathname === "/login" || pathname.startsWith("/api/auth/");

  if (isAuthRoute) return NextResponse.next();

  if (isApi && req.headers.get("x-ankify-token")) {
    return NextResponse.next();
  }

  const hasSessionCookie = req.cookies
    .getAll()
    .some((cookie) => cookie.name.endsWith("better-auth.session_token"));
  if (hasSessionCookie) {
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
