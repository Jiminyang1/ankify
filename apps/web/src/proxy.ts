import { NextResponse, type NextRequest } from "next/server";

const API_METHODS = "GET,POST,PATCH,DELETE,OPTIONS";
const API_HEADERS = "Content-Type";

function allowedExtensionOrigins() {
  return (process.env.ANKIFY_EXTENSION_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.startsWith("chrome-extension://"));
}

function withApiCors(req: NextRequest, res: NextResponse) {
  const origin = req.headers.get("origin");
  const allowlist = allowedExtensionOrigins();
  const allowed =
    origin?.startsWith("chrome-extension://") &&
    (allowlist.includes(origin) ||
      (allowlist.length === 0 && process.env.NODE_ENV !== "production"));
  if (origin && allowed) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Methods", API_METHODS);
    res.headers.set("Access-Control-Allow-Headers", API_HEADERS);
    res.headers.set("Access-Control-Allow-Credentials", "true");
    res.headers.set("Access-Control-Max-Age", "86400");
    res.headers.append("Vary", "Origin");
  }
  return res;
}

/**
 * Lightweight gate only. API routes and server pages validate the Better Auth
 * session again before touching data.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isPublicRoute =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname.startsWith("/api/auth/");

  if (isApi && req.method === "OPTIONS") {
    return withApiCors(req, new NextResponse(null, { status: 204 }));
  }

  if (isPublicRoute) {
    const res = NextResponse.next();
    return isApi ? withApiCors(req, res) : res;
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
