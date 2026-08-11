import { NextResponse } from "next/server";
import { updateCardPatchSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { updateOwnedCard } from "@/server/card-commands";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = updateCardPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await updateOwnedCard(user.id, id, parsed.data);
  if (!result.ok && result.error === "not_found") {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: "card_version_conflict", message: "Card changed elsewhere. Refresh and retry." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, card: result.card });
}
