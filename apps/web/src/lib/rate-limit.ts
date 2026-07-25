import { NextResponse } from "next/server";
import { getDb, schema } from "@ankify/db";
import { sql } from "drizzle-orm";

/**
 * Database-backed fixed-window rate limiter. The counter lives in the
 * user-scoped settings table and is updated atomically by one SQLite UPSERT, so
 * all Vercel instances share the same limit. One stable row per scope avoids
 * accumulating one row for every time window.
 */
type StoredWindow = { windowStart: number; count: number };

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

export async function checkRateLimit(
  userId: string,
  scope: string,
  opts: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = Math.floor(now / opts.windowMs) * opts.windowMs;
  const key = `rate-limit:${scope}`;
  const db = getDb();
  const [row] = await db
    .insert(schema.settings)
    .values({
      userId,
      key,
      value: { windowStart, count: 1 } satisfies StoredWindow,
      updatedAt: new Date(now),
    })
    .onConflictDoUpdate({
      target: [schema.settings.userId, schema.settings.key],
      set: {
        value: sql`
          CASE
            WHEN CAST(json_extract(${schema.settings.value}, '$.windowStart') AS INTEGER) = ${windowStart}
              THEN json_object(
                'windowStart', ${windowStart},
                'count', CAST(json_extract(${schema.settings.value}, '$.count') AS INTEGER) + 1
              )
            ELSE json_object('windowStart', ${windowStart}, 'count', 1)
          END
        `,
        updatedAt: new Date(now),
      },
    })
    .returning({ value: schema.settings.value });

  const stored = row?.value as Partial<StoredWindow> | undefined;
  const count = typeof stored?.count === "number" ? stored.count : opts.limit + 1;
  const ok = count <= opts.limit;
  return {
    ok,
    remaining: ok ? Math.max(0, opts.limit - count) : 0,
    retryAfterSec: ok
      ? 0
      : Math.max(1, Math.ceil((windowStart + opts.windowMs - now) / 1000)),
  };
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
