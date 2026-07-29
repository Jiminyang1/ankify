import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getAiSettings,
  getGenerationSettings,
  getReviewSettings,
  setAiSettings,
  setGenerationSettings,
  setReviewSettings,
} from "@/lib/settings";
import { getRequestSessionUser, unauthorizedResponse } from "@/lib/auth";
import { schemas } from "@ankify/core";
import { isValidTimeZone } from "@/lib/time-zone";

const settingsSchema = z
  .object({
    provider: schemas.aiProviderEnum.optional(),
    model: z.string().min(1).optional(),
    reasoningMode: schemas.aiReasoningModeEnum.optional(),
    apiKey: z.string().optional(),
    dailyReviewLimit: z.number().int().min(1).max(100).optional(),
    timeZone: z.string().max(128).refine(isValidTimeZone, "Invalid IANA time zone.").optional(),
    generationLanguage: z.enum(["en", "zh"]).optional(),
  })
  .refine(
    (value) =>
      value.dailyReviewLimit != null ||
      value.timeZone != null ||
      value.generationLanguage != null ||
      Boolean(value.provider && value.model),
    {
      message: "Provide AI provider/model, review settings, or generation settings.",
    },
  );

export async function GET(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const [ai, review, generation] = await Promise.all([
    getAiSettings(user.id),
    getReviewSettings(user.id),
    getGenerationSettings(user.id),
  ]);
  // Don't leak the key back to the client; just whether one is set
  return NextResponse.json({
    ai: {
      provider: ai.provider,
      model: ai.model,
      reasoningMode: ai.reasoningMode,
      hasApiKey: Boolean(ai.encryptedApiKey),
    },
    review,
    generation,
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
      reasoningMode: parsed.data.reasoningMode,
      apiKey: parsed.data.apiKey,
    });
  }
  if (parsed.data.dailyReviewLimit != null || parsed.data.timeZone != null) {
    await setReviewSettings(user.id, {
      dailyReviewLimit: parsed.data.dailyReviewLimit,
      timeZone: parsed.data.timeZone,
    });
  }
  if (parsed.data.generationLanguage != null) {
    await setGenerationSettings(user.id, { language: parsed.data.generationLanguage });
  }
  return NextResponse.json({ ok: true });
}
