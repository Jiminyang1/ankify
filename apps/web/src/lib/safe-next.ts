/**
 * A same-site path to continue to after signing in, or `/today`. Browsers
 * normalize "\" to "/" in Location URLs, so "/\evil.com" would become a
 * protocol-relative external redirect: backslashes are rejected outright, as
 * are API routes.
 */
export function safeNextPath(next: string | null | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || next.startsWith("/api/")) {
    return "/today";
  }
  return next;
}
