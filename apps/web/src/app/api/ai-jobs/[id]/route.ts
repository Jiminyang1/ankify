import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { cancelOwnedAiJob, getOwnedAiJob, toPublicAiJob } from "@/server/ai-generation/jobs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await ctx.params;
  const job = await getOwnedAiJob(user.id, id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, job: toPublicAiJob(job) });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await ctx.params;
  const job = await cancelOwnedAiJob(user.id, id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, job: toPublicAiJob(job) });
}
