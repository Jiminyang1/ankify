import { NextResponse } from "next/server";
import { z } from "zod";
import { aiProviderEnum } from "@ankify/contracts";
import { listAvailableAiModels } from "@/server/ai-models";
import { getRequestSessionUser, unauthorizedResponse } from "@/server/auth";

// Listing models is a single cheap GET against the provider. Card and quiz
// generation need minutes; this does not, and a long hang here just leaves the
// Settings dropdown spinning.
export const maxDuration = 30;

const requestSchema = z.object({
  provider: aiProviderEnum,
  apiKey: z.string().min(1).max(512).optional(),
});

/**
 * POST /api/settings/ai-models
 *
 * Lists chat-capable models from the user's chosen provider so the Settings
 * UI doesn't go stale when Anthropic / OpenAI / DeepSeek release new models.
 *
 * Body: { provider, apiKey? }. Falls back to the user's stored encrypted key
 * when apiKey is omitted, so users can refresh model lists without retyping
 * the key. Session-only.
 */
export async function POST(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const body = await req.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await listAvailableAiModels(user.id, parsed.data);
  return NextResponse.json(result, {
    status: "error" in result ? 400 : 200,
  });
}
