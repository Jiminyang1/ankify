import { reviewUndoSchema } from "@ankify/contracts";
import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { isWorkflowEnabled, legacyWorkflowResponse } from "@/server/features";
import { undoLatestProblemReview } from "@/server/review-commands";

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  // After the extension-first cutover, old clients may not bypass
  // session-based scheduling.
  if (!isWorkflowEnabled("legacy_review")) return legacyWorkflowResponse("legacy_review");

  const parsed = reviewUndoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await undoLatestProblemReview(user.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "problem_not_found" ? 404 : 409 },
    );
  }
  return NextResponse.json(result);
}
