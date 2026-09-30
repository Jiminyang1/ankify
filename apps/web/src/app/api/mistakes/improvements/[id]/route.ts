import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { deleteImprovement } from "@/server/mistakes";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await ctx.params;
  if (!(await deleteImprovement(user.id, id))) return NextResponse.json({ error: "improvement_not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
