import { NextResponse } from "next/server";
import { weaknessPatchSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { setWeaknessStatus } from "@/server/weaknesses";

/** PATCH /api/weaknesses/:id — `{ status }`: remove (dismissed), resolve, or reopen. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const parsed = weaknessPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const { id } = await ctx.params;
  const weakness = await setWeaknessStatus(user.id, id, parsed.data.status);
  if (!weakness) return NextResponse.json({ error: "weakness_not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, weakness });
}
