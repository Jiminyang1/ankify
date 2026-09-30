import {
  captureSubmissionSchema,
  fsrsRatingSchema,
  leetcodeAvailabilityEnum,
  leetcodeSlugSchema,
  practiceModeEnum,
  practiceProblemSchema,
  sessionBaselineSchema,
  sessionObservationSchema,
  skillDimensionEnum,
} from "@ankify/contracts";
import { z } from "zod";

/**
 * Messages into the background worker. Every message is validated against
 * these schemas, and its sender must match the channel: content scripts only
 * from the top frame of a LeetCode problem page, extension pages only from
 * this extension's own origin. Owner tokens never cross into content scripts;
 * the worker attaches the sending tab's token itself.
 */

const sessionIdSchema = z.string().min(1).max(64);
const MAX_ACTIVITY_DELTA_MS = 10 * 60_000;

const sessionControl = z.discriminatedUnion("command", [
  z.object({ command: z.literal("resume") }).strict(),
  /** "Continue here" from another tab. */
  z.object({ command: z.literal("takeover") }).strict(),
  z.object({ command: z.literal("set_baseline"), baseline: sessionBaselineSchema }).strict(),
  z.object({ command: z.literal("finish"), result: z.enum(["solved", "unsuccessful"]), occurredAt: z.string().datetime() }).strict(),
  z.object({ command: z.literal("abandon"), occurredAt: z.string().datetime() }).strict(),
]);
export type SessionControl = z.infer<typeof sessionControl>;

const ratingMessages = [
  z.object({ type: z.literal("session_rating"), sessionId: sessionIdSchema, rating: fsrsRatingSchema }).strict(),
  z.object({ type: z.literal("session_rating_decision"), sessionId: sessionIdSchema, decision: z.enum(["defer", "dismiss"]) }).strict(),
] as const;

export const contentMessageSchema = z.discriminatedUnion("type", [
  /** What the panel on this problem page should show. */
  z.object({ type: z.literal("page_state"), slug: leetcodeSlugSchema }).strict(),
  /** Display preferences the panel may know (content scripts cannot read extension storage). */
  z.object({ type: z.literal("panel_settings") }).strict(),
  /** Import past submissions of a problem already in the deck (never schedules anything). */
  z
    .object({
      type: z.literal("import_history"),
      slug: leetcodeSlugSchema,
      problem: practiceProblemSchema,
      submissions: z.array(captureSubmissionSchema).max(20),
    })
    .strict(),
  z
    .object({
      type: z.literal("session_start"),
      slug: leetcodeSlugSchema,
      mode: practiceModeEnum,
      problem: practiceProblemSchema,
      baseline: sessionBaselineSchema.optional(),
      sourceAccount: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/).optional(),
      supersedePendingRating: z.boolean().default(false),
    })
    .strict(),
  z.object({ type: z.literal("session_control"), sessionId: sessionIdSchema, control: sessionControl }).strict(),
  /** Foreground and tracked time since the previous report, plus LeetCode availability. */
  z
    .object({
      type: z.literal("session_activity"),
      sessionId: sessionIdSchema,
      activeMs: z.number().int().min(0).max(MAX_ACTIVITY_DELTA_MS),
      observedMs: z.number().int().min(0).max(MAX_ACTIVITY_DELTA_MS),
      availability: leetcodeAvailabilityEnum,
    })
    .strict(),
  z
    .object({
      type: z.literal("session_observations"),
      sessionId: sessionIdSchema,
      observations: z.array(sessionObservationSchema).min(1).max(20),
    })
    .strict(),
  ...ratingMessages,
  /** Session analysis: read its state, start one (the user's own key), and
   *  confirm, recategorize, or dismiss a suggested finding. */
  z.object({ type: z.literal("analysis_state"), sessionId: sessionIdSchema }).strict(),
  z.object({ type: z.literal("analysis_start"), sessionId: sessionIdSchema }).strict(),
  z
    .object({
      type: z.literal("analysis_finding"),
      mistakeId: sessionIdSchema,
      decision: z.enum(["confirm", "dismiss"]),
      category: skillDimensionEnum.optional(),
    })
    .strict(),
]);
export type ContentMessage = z.infer<typeof contentMessageSchema>;

export const pageMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth_status") }).strict(),
  z.object({ type: z.literal("overview") }).strict(),
  z.object({ type: z.literal("capabilities") }).strict(),
  /** Start (or resume) a due review, then open its problem page. */
  z
    .object({
      type: z.literal("open_review"),
      problemId: sessionIdSchema,
      slug: leetcodeSlugSchema,
      supersedePendingRating: z.boolean().default(false),
    })
    .strict(),
  z.object({ type: z.literal("open_problem"), slug: leetcodeSlugSchema }).strict(),
  /** Act on a session that no tab controls (interrupted), from the popup. */
  z.object({ type: z.literal("session_control"), sessionId: sessionIdSchema, control: sessionControl }).strict(),
  ...ratingMessages,
  z.object({ type: z.literal("sync_status") }).strict(),
  z.object({ type: z.literal("sync_retry") }).strict(),
  /** Notes of the problem in the active tab, when it is in the deck. */
  z.object({ type: z.literal("notes_load"), slug: leetcodeSlugSchema }).strict(),
  z.object({ type: z.literal("notes_save"), problemId: sessionIdSchema, notes: z.string().max(50_000) }).strict(),
]);
export type PageMessage = z.infer<typeof pageMessageSchema>;

export type MessageSender = {
  id?: string;
  url?: string;
  frameId?: number;
  tab?: { id?: number; url?: string };
};

export type SenderContext =
  | { kind: "content"; tabId: number; slug: string }
  | { kind: "page" };

/**
 * Accepts only this extension's senders: a content script in the top frame of
 * `https://leetcode.com/problems/<slug>/...`, or an extension page (popup).
 */
export function classifySender(sender: MessageSender, extensionId: string): SenderContext | null {
  if (sender.id !== extensionId || !sender.url) return null;
  let url: URL;
  try {
    url = new URL(sender.url);
  } catch {
    return null;
  }
  // Extension pages (the popup, or one opened in a tab) are identified by
  // their own origin, which no web page can claim.
  if (url.protocol === "chrome-extension:") return url.host === extensionId ? { kind: "page" } : null;
  if (sender.tab) {
    if (sender.tab.id == null || sender.frameId !== 0 || url.origin !== "https://leetcode.com") return null;
    // LeetCode switches problems with history.pushState; the sender URL can
    // still show the previous problem, while the tab's URL is current.
    let current = url;
    try {
      if (sender.tab.url) current = new URL(sender.tab.url);
    } catch {
      return null;
    }
    if (current.origin !== "https://leetcode.com") return null;
    const slug = current.pathname.match(/^\/problems\/([^/]+)(?:\/|$)/)?.[1];
    const parsed = leetcodeSlugSchema.safeParse(slug);
    return parsed.success ? { kind: "content", tabId: sender.tab.id, slug: parsed.data } : null;
  }
  return null;
}

/** Validates a message for its sender's channel; `null` when it is rejected. */
export function parseMessage(message: unknown, sender: SenderContext) {
  if (sender.kind === "content") {
    const parsed = contentMessageSchema.safeParse(message);
    if (!parsed.success) return null;
    // A page can only speak about its own problem.
    const slug = "slug" in parsed.data ? parsed.data.slug : null;
    if (slug && slug !== sender.slug) return null;
    if ((parsed.data.type === "session_start" || parsed.data.type === "import_history") && parsed.data.problem.leetcodeSlug !== sender.slug) return null;
    return { channel: "content" as const, message: parsed.data };
  }
  const parsed = pageMessageSchema.safeParse(message);
  return parsed.success ? { channel: "page" as const, message: parsed.data } : null;
}
