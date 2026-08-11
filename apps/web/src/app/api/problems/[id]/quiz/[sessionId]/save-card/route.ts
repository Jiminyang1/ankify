import { NextResponse } from "next/server";
import { quizSaveCardRequestSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { saveQuizItemAsCard } from "@/server/card-commands";

export async function POST(req: Request, ctx: { params: Promise<{ id: string; sessionId: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { id: problemId, sessionId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = quizSaveCardRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await saveQuizItemAsCard(
    user.id,
    problemId,
    sessionId,
    parsed.data.itemId,
  );
  if (
    !result.ok &&
    (result.error === "quiz_session_not_found" || result.error === "quiz_item_not_found")
  ) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  if (!result.ok && result.error === "card_limit_reached") {
    return NextResponse.json(
      {
        error: result.error,
        message: `This problem already has ${result.limit} cards. Delete one before saving another.`,
      },
      { status: 403 },
    );
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json({ ok: true, card: result.card });
}
