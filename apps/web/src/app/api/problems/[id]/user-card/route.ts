import { NextResponse } from "next/server";
import { userCardManualCreateSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { createManualCard } from "@/server/card-commands";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { id: problemId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = userCardManualCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await createManualCard(user.id, problemId, parsed.data);
  if (!result.ok && result.error === "problem_not_found") {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        message: `This problem already has ${result.limit} cards. Delete one before adding another.`,
      },
      { status: 403 },
    );
  }

  return NextResponse.json({ ok: true, cardId: result.cardId }, { status: 201 });
}
