import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@ankify/db";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";

/**
 * Legacy, read-only, for extension builds 0.3.x: when they load a Coach
 * conversation, they look up the job behind each card or quiz proposal the
 * user approved before that generation was removed, and poll it until it's
 * finished. Nothing creates or runs jobs any more, so one that never finished
 * reads as cancelled.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await ctx.params;
  const [job] = await getDb()
    .select({
      id: schema.aiJobs.id,
      problemId: schema.aiJobs.problemId,
      action: schema.aiJobs.action,
      status: schema.aiJobs.status,
      errorCode: schema.aiJobs.errorCode,
      errorMessage: schema.aiJobs.errorMessage,
    })
    .from(schema.aiJobs)
    .where(and(eq(schema.aiJobs.id, id), eq(schema.aiJobs.userId, user.id)))
    .limit(1);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const unfinished = job.status === "queued" || job.status === "running";
  return NextResponse.json({ ok: true, job: { ...job, status: unfinished ? "cancelled" : job.status } });
}
