import { NextResponse } from "next/server";
import { coachModels } from "@/server/ai/model-choice";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { getAiRuntimeSettings } from "@/server/settings";

/** GET the models the Coach's picker offers for the user's AI settings. */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  try {
    return NextResponse.json(coachModels(await getAiRuntimeSettings(user.id)));
  } catch {
    // No AI configured: nothing to pick from. Turns report the setup error.
    return NextResponse.json({ error: "ai_not_configured" }, { status: 404 });
  }
}
