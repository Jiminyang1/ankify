import type { ContentMessage, PageMessage } from "../shared/protocol";

/** Sent by the worker when session state may have changed. */
export const SESSION_CHANGED = { type: "session_changed" } as const;

const CONTENT_CHANGES = new Set<ContentMessage["type"]>([
  "session_start",
  "session_control",
  "session_observations",
  "session_rating",
  "session_rating_decision",
]);
const PAGE_CHANGES = new Set<PageMessage["type"]>([
  "open_review",
  "session_control",
  "session_rating",
  "session_rating_decision",
  "suggestion_start",
  "sync_retry",
]);

/**
 * Whether a handled message may have changed what the popup or a problem page
 * shows: a session started or ended, a rating, new evidence, or a change in
 * what waits to sync. Failed attempts change nothing.
 */
export function changesSessionState(
  parsed: { channel: "content"; message: ContentMessage } | { channel: "page"; message: PageMessage },
  response: unknown,
) {
  const types: Set<string> = parsed.channel === "content" ? CONTENT_CHANGES : PAGE_CHANGES;
  if (!types.has(parsed.message.type)) return false;
  return !(response && typeof response === "object" && (response as { ok?: unknown }).ok === false);
}
