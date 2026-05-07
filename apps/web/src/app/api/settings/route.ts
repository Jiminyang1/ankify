import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getAiSettings,
  getReviewSettings,
  setAiSettings,
  setReviewSettings,
} from "@/lib/settings";
import { getRequestSessionUser, unauthorizedResponse } from "@/lib/auth";
import { schemas } from "@ankify/core";

const settingsSchema = z
  .object({
    provider: schemas.aiProviderEnum.optional(),
    model: z.string().min(1).optional(),
    apiKey: z.string().optional(),
    dailyReviewLimit: z.number().int().min(1).max(100).optional(),
  })
  .refine(
    (value) => value.dailyReviewLimit != null || Boolean(value.provider && value.model),
    {
      message: "Provide AI provider/model or dailyReviewLimit.",
    },
  );

export async function GET(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const [ai, review] = await Promise.all([getAiSettings(user.id), getReviewSettings(user.id)]);
  // Don't leak the key back to the client; just whether one is set
  return NextResponse.json({
    ai: { provider: ai.provider, model: ai.model, hasApiKey: Boolean(ai.encryptedApiKey) },
    review,
  });
}

export async function POST(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const body = await req.json().catch(() => null);
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }
  if (parsed.data.provider && parsed.data.model) {
    await setAiSettings(user.id, {
      provider: parsed.data.provider,
      model: parsed.data.model,
      apiKey: parsed.data.apiKey,
    });
  }
  if (parsed.data.dailyReviewLimit != null) {
    await setReviewSettings(user.id, { dailyReviewLimit: parsed.data.dailyReviewLimit });
  }
  return NextResponse.json({ ok: true });
}
