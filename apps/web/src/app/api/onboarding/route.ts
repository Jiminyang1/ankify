import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestSessionUser, unauthorizedResponse } from "@/server/auth";
import {
  getOnboardingProgress,
  markAiSkipped,
  markExtensionConnected,
} from "@/server/onboarding";

const actionSchema = z.object({
  action: z.enum(["extension_connected", "skip_ai"]),
});

export async function GET(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();
  return NextResponse.json({ onboarding: await getOnboardingProgress(user.id) });
}

export async function POST(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  if (parsed.data.action === "extension_connected") {
    await markExtensionConnected(user.id);
  } else {
    await markAiSkipped(user.id);
  }
  return NextResponse.json({ onboarding: await getOnboardingProgress(user.id) });
}
