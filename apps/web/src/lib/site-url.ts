/**
 * Canonical origin for crawler-facing files. robots.ts and sitemap.ts must
 * agree, so both read it from here rather than each building their own.
 */
export function getSiteUrl() {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  return (configured || "http://localhost:3000").replace(/\/+$/, "");
}
