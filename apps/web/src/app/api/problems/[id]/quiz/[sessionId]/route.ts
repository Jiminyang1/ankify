import { NextResponse } from "next/server";
import { quizAnswerRequestSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { answerQuizItem } from "@/server/quiz-commands";

const ERROR_STATUS = {
  quiz_session_not_found: 404,
  quiz_session_not_active: 400,
  quiz_item_not_found: 404,
  quiz_item_already_answered: 400,
  quiz_answer_conflict: 409,
} as const;

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; sessionId: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { id: problemId, sessionId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = quizAnswerRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await answerQuizItem(user.id, problemId, sessionId, parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: ERROR_STATUS[result.error] },
    );
  }
  return NextResponse.json(result);
}
