import { NextResponse } from "next/server";
import { auth, getRequestSessionUser, unauthorizedResponse } from "@/lib/auth";

export async function DELETE(req: Request, ctx: { params: Promise<{ keyId: string }> }) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const { keyId } = await ctx.params;
  await auth.api.deleteApiKey({
    headers: req.headers,
    body: { keyId },
  });

  return NextResponse.json({ ok: true });
}
