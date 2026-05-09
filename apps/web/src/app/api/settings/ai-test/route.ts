import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { schemas } from "@ankify/core";
import { getRequestSessionUser, unauthorizedResponse } from "@/lib/auth";
import { buildModel } from "@/lib/ai";
import { getAiSettings } from "@/lib/settings";
import { decryptSecret } from "@/lib/secret-box";

export const maxDuration = 180;

const testRequestSchema = z.object({
  provider: schemas.aiProviderEnum.optional(),
  model: z.string().min(1).max(128).optional(),
  apiKey: z.string().min(1).max(512).optional(),
});

const probeSchema = z.object({ ok: z.literal(true) });

/**
 * POST /api/settings/ai-test
 *
 * Runs a tiny generateObject call against the configured (or supplied)
 * provider/model/apiKey to verify the connection. Body fields are optional
 * overrides so users can test a new key before saving it. Falls back to the
 * user's stored AI settings for any field that's omitted.
 *
 * Session-only (extension tokens cannot test settings).
 */
export async function POST(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const body = await req.json().catch(() => ({}));
  const parsed = testRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const stored = await getAiSettings(user.id);
  const provider = parsed.data.provider ?? (stored.provider || undefined);
  const model = parsed.data.model ?? (stored.model || undefined);
  const apiKey =
    parsed.data.apiKey ??
    (stored.encryptedApiKey ? safeDecrypt(stored.encryptedApiKey) : undefined);

  if (!provider) return NextResponse.json({ ok: false, code: "missing_provider" }, { status: 400 });
  if (!model) return NextResponse.json({ ok: false, code: "missing_model" }, { status: 400 });
  if (!apiKey) return NextResponse.json({ ok: false, code: "missing_api_key" }, { status: 400 });

  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 175_000);

  try {
    // Probe is short and structured — disable DeepSeek thinking for this call
    // to avoid wasting reasoning tokens on a {ok: true} reply.
    const llm = buildModel({ provider, model, apiKey }, { disableThinking: true });
    const mode = provider === "deepseek" ? "json" : "auto";
    await generateObject({
      model: llm,
      schema: probeSchema,
      system: "You are a connection probe. Respond with {\"ok\": true}.",
      prompt: 'Respond with the JSON object {"ok": true} and nothing else.',
      temperature: 0,
      mode,
      abortSignal: controller.signal,
    });
    return NextResponse.json({ ok: true, provider, model, latencyMs: Date.now() - t0 });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        ...classifyAiError(err),
        provider,
        model,
        latencyMs: Date.now() - t0,
      },
      { status: 200 },
    );
  } finally {
    clearTimeout(timer);
  }
}

function safeDecrypt(envelope: NonNullable<Awaited<ReturnType<typeof getAiSettings>>["encryptedApiKey"]>) {
  try {
    return decryptSecret(envelope);
  } catch {
    return undefined;
  }
}

function classifyAiError(err: unknown): { code: string; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes("aborted") || lower.includes("timeout")) {
    return { code: "timeout", message: "Provider did not respond within 3 minutes." };
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid api key") || lower.includes("authentication")) {
    return { code: "invalid_api_key", message: "API key was rejected by the provider." };
  }
  if (lower.includes("403") || lower.includes("forbidden") || lower.includes("permission")) {
    return { code: "forbidden", message: "API key does not have access to this model." };
  }
  if (lower.includes("404") || lower.includes("not found") || lower.includes("model_not_found") || lower.includes("does not exist")) {
    return { code: "model_not_found", message: "Model id was not recognized by the provider." };
  }
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("quota") || lower.includes("insufficient")) {
    return { code: "quota_or_rate_limit", message: "Provider returned a rate limit or quota error." };
  }
  if (lower.includes("network") || lower.includes("fetch failed") || lower.includes("enotfound") || lower.includes("econnrefused")) {
    return { code: "network", message: "Could not reach the provider." };
  }
  return { code: "unknown", message: raw.slice(0, 500) };
}
