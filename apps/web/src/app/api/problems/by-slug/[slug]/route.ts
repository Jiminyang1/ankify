import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { loadProblemSnapshotBySlug } from "@/server/problem-snapshot";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { slug } = await ctx.params;
  const snapshot = await loadProblemSnapshotBySlug(user.id, slug);
  if (!snapshot) {
    return NextResponse.json({ error: "not_captured" }, { status: 404 });
  }
  return NextResponse.json(snapshot);
}
