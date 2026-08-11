import { NextResponse } from "next/server";
import { z } from "zod";
import { aiProviderEnum } from "@ankify/contracts";
import { getRequestSessionUser, unauthorizedResponse } from "@/server/auth";
import { testAiConnection } from "@/server/ai-connection";

export const maxDuration = 180;

const testRequestSchema = z.object({
  provider: aiProviderEnum.optional(),
  model: z.string().min(1).max(128).optional(),
  apiKey: z.string().min(1).max(512).optional(),
  saveOnSuccess: z.boolean().optional(),
});

/**
 * POST /api/settings/ai-test
 *
 * Runs a tiny generateObject call against the configured (or supplied)
 * provider/model/apiKey to verify the connection. Body fields are optional
 * overrides so users can test a new key before saving it. Falls back to the
 * user's stored AI settings for any field that's omitted.
 *
 * Session-only.
 */
export async function POST(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const body = await req.json().catch(() => ({}));
  const parsed = testRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await testAiConnection(user.id, parsed.data);
  if (
    !result.ok &&
    (result.code === "missing_provider" ||
      result.code === "missing_model" ||
      result.code === "missing_api_key")
  ) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result, { status: 200 });
}
