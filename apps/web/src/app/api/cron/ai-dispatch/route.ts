import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { redispatchStrandedJobs } from "@/server/session-analysis/jobs";

/**
 * GET /api/cron/ai-dispatch — re-sends AI jobs whose queue dispatch never
 * happened. Called by a scheduler with `Authorization: Bearer $CRON_SECRET`
 * (Vercel Cron sends this header); disabled while `CRON_SECRET` is unset.
 * Not scheduled in vercel.json until the deployment tier is verified, see
 * DEPLOYMENT.md.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 404 });
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(req.headers.get("authorization") ?? "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await redispatchStrandedJobs({ limit: 100 }));
}
