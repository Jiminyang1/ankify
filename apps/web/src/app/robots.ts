import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

/**
 * Only the public marketing pages are crawlable. Everything else is either
 * behind auth or an API surface with nothing to index.
 *
 * This is discovery, not access control — the app routes are protected by the
 * Better Auth session, and an unauthenticated request to them redirects to
 * /login regardless of what this file says.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacy", "/terms"],
      disallow: [
        "/api/",
        "/login",
        "/today",
        "/review",
        "/problems",
        "/analysis",
        "/settings",
        "/extension-connected",
      ],
    },
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
