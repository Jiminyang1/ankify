import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth gate for `/api/*`.
 *
 * Rule:
 *   - Same-origin requests (the web UI itself) are trusted.
 *   - Cross-origin requests (the Chrome extension, curl, anything else) must
 *     present `x-ankify-token` matching `ANKIFY_API_TOKEN`.
 *   - In production, a missing `ANKIFY_API_TOKEN` env var is fail-closed.
 *   - In development, a missing token is permissive so `pnpm dev` just works.
 */
export function middleware(req: NextRequest) {
  const expected = process.env.ANKIFY_API_TOKEN;

  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("server misconfigured: ANKIFY_API_TOKEN missing", {
        status: 500,
      });
    }
    return NextResponse.next();
  }

  // Same-origin: web UI is trusted. The browser always sends Origin on
  // cross-origin and on same-origin POST/PUT/DELETE; same-origin GETs may
  // omit it, in which case we allow (they can't be forged from a third party).
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host === req.headers.get("host")) {
        return NextResponse.next();
      }
    } catch {
      // malformed Origin: fall through to token check
    }
  } else if (req.method === "GET" || req.method === "HEAD") {
    return NextResponse.next();
  }

  const got = req.headers.get("x-ankify-token");
  if (got !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
