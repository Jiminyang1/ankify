import { NextResponse, type NextRequest } from "next/server";

const API_METHODS = "GET,POST,PATCH,DELETE,OPTIONS";
const API_HEADERS = "Content-Type, X-Ankify-Token";

function withApiCors(req: NextRequest, res: NextResponse) {
  const origin = req.headers.get("origin");
  if (origin?.startsWith("chrome-extension://")) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Methods", API_METHODS);
    res.headers.set("Access-Control-Allow-Headers", API_HEADERS);
    res.headers.set("Access-Control-Max-Age", "86400");
    res.headers.append("Vary", "Origin");
  }
  return res;
}

/**
 * Lightweight gate only. API routes and server pages validate the Better Auth
 * session/API key again before touching data.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isAuthRoute = pathname === "/login" || pathname.startsWith("/api/auth/");

  if (isAuthRoute) return NextResponse.next();

  if (isApi && req.method === "OPTIONS") {
    return withApiCors(req, new NextResponse(null, { status: 204 }));
  }

  if (isApi && req.headers.get("x-ankify-token")) {
    return withApiCors(req, NextResponse.next());
  }

  const hasSessionCookie = req.cookies
    .getAll()
    .some((cookie) => cookie.name.endsWith("better-auth.session_token"));
  if (hasSessionCookie) {
    const res = NextResponse.next();
    return isApi ? withApiCors(req, res) : res;
  }

  if (isApi) {
    return withApiCors(req, NextResponse.json({ error: "unauthorized" }, { status: 401 }));
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
