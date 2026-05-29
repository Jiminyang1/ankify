import { NextResponse } from "next/server";

/**
 * Best-effort in-memory rate limiter.
 *
 * On serverless (Vercel) every warm instance keeps its own window map, so this
 * is NOT a globally exact limit — it's a cheap guardrail that stops a single
 * client from hammering one instance, and it resets on cold start (fine for
 * abuse mitigation). Hard, globally-accurate caps (e.g. the per-user problem
 * quota in capture) are enforced in the database instead.
 *
 * This matters most once `ANKIFY_OPEN_SIGNUP` is on: any Google account can
 * sign in, so the expensive paths (AI generation, capture writes) need a floor
 * of protection even though each user pays for their own AI key.
 */
type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();
let lastSweep = 0;

/** Drop expired windows at most once a minute so the map can't grow unbounded. */
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, w] of windows) {
    if (w.resetAt <= now) windows.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/** Named limits so call sites read intent, not magic numbers. */
export const RATE_LIMITS = {
  /** AI generation (cards, quizzes): expensive + slow, tightest cap. */
  ai: { limit: 20, windowMs: 60_000 },
  /** Capture writes: cheaper, but the extension can fire in bursts. */
  capture: { limit: 60, windowMs: 60_000 },
} as const;

/** Hard cap on non-archived problems per user — enforced in the DB on create. */
export const MAX_PROBLEMS_PER_USER = 2000;

export function checkRateLimit(key: string, opts: { limit: number; windowMs: number }): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true, remaining: opts.limit - 1, retryAfterSec: 0 };
  }
  if (existing.count >= opts.limit) {
    return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  existing.count += 1;
  return { ok: true, remaining: opts.limit - existing.count, retryAfterSec: 0 };
}

export function rateLimitResponse(retryAfterSec: number) {
  return NextResponse.json(
    {
      error: "rate_limited",
      message: "Too many requests. Please slow down and try again shortly.",
      retryAfterSec,
    },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}
