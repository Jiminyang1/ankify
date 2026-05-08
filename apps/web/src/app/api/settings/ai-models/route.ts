import { NextResponse } from "next/server";
import { z } from "zod";
import { schemas, type AiProvider } from "@ankify/core";
import { getRequestSessionUser, unauthorizedResponse } from "@/lib/auth";
import { getAiSettings } from "@/lib/settings";
import { decryptSecret } from "@/lib/secret-box";

export const maxDuration = 15;

const requestSchema = z.object({
  provider: schemas.aiProviderEnum,
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

  const { provider } = parsed.data;
  let apiKey = parsed.data.apiKey;
  if (!apiKey) {
    const stored = await getAiSettings(user.id);
    if (stored.encryptedApiKey) {
      try {
        apiKey = decryptSecret(stored.encryptedApiKey);
      } catch {
        // fall through; treated as missing key
      }
    }
  }
  if (!apiKey) {
    return NextResponse.json({ error: "missing_api_key" }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const models = await listModels(provider, apiKey, controller.signal);
    return NextResponse.json({ ok: true, provider, models });
  } catch (err) {
    return NextResponse.json(
      { ok: false, ...classifyListError(err) },
      { status: 200 },
    );
  } finally {
    clearTimeout(timer);
  }
}

interface ModelEntry {
  id: string;
  label?: string;
}

async function listModels(provider: AiProvider, apiKey: string, signal: AbortSignal): Promise<ModelEntry[]> {
  switch (provider) {
    case "anthropic":
      return listAnthropic(apiKey, signal);
    case "openai":
      return listOpenAi(apiKey, signal);
    case "deepseek":
      return listDeepseek(apiKey, signal);
    default:
      throw new Error(`unsupported_provider: ${provider}`);
  }
}

async function listAnthropic(apiKey: string, signal: AbortSignal): Promise<ModelEntry[]> {
  const res = await fetch("https://api.anthropic.com/v1/models?limit=1000", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal,
  });
  if (!res.ok) throw new ProviderError(res.status, await res.text().catch(() => ""));
  const json = (await res.json()) as { data?: Array<{ id: string; display_name?: string }> };
  const items = (json.data ?? [])
    .map((m) => ({ id: m.id, label: m.display_name }))
    .filter((m) => m.id.startsWith("claude-"));
  // Newest first by id ordering convention (claude-opus-4-7 > claude-opus-4-6).
  items.sort((a, b) => b.id.localeCompare(a.id));
  return items;
}

async function listOpenAi(apiKey: string, signal: AbortSignal): Promise<ModelEntry[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!res.ok) throw new ProviderError(res.status, await res.text().catch(() => ""));
  const json = (await res.json()) as { data?: Array<{ id: string }> };
  const items = (json.data ?? [])
    .map((m) => ({ id: m.id }))
    .filter((m) => isOpenAiChatModel(m.id));
  items.sort((a, b) => b.id.localeCompare(a.id));
  return items;
}

async function listDeepseek(apiKey: string, signal: AbortSignal): Promise<ModelEntry[]> {
  const res = await fetch("https://api.deepseek.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!res.ok) throw new ProviderError(res.status, await res.text().catch(() => ""));
  const json = (await res.json()) as { data?: Array<{ id: string }> };
  const items = (json.data ?? []).map((m) => ({ id: m.id }));
  items.sort((a, b) => b.id.localeCompare(a.id));
  return items;
}

/** Heuristic filter for OpenAI chat-completion-capable models. The /v1/models
 *  response is unannotated, so we keep ids that look like chat/reasoning
 *  models and drop embeddings, audio, image, moderation, and legacy variants. */
function isOpenAiChatModel(id: string): boolean {
  const lower = id.toLowerCase();
  const blocklist = [
    "embed",
    "whisper",
    "tts",
    "dall-e",
    "moderation",
    "audio",
    "realtime",
    "image",
    "transcribe",
    "babbage",
    "davinci-edit",
    "instruct",
    "search",
  ];
  if (blocklist.some((kw) => lower.includes(kw))) return false;
  // Chat-capable id shapes: gpt-*, chatgpt-*, o<digit>* (o1, o3, o4, …).
  if (lower.startsWith("gpt-")) return true;
  if (lower.startsWith("chatgpt")) return true;
  if (/^o\d/.test(lower)) return true;
  return false;
}

class ProviderError extends Error {
  constructor(public status: number, public body: string) {
    super(`provider_${status}`);
  }
}

function classifyListError(err: unknown): { code: string; message: string } {
  if (err instanceof ProviderError) {
    if (err.status === 401) return { code: "invalid_api_key", message: "API key was rejected by the provider." };
    if (err.status === 403) return { code: "forbidden", message: "API key cannot list models." };
    if (err.status === 429) return { code: "quota_or_rate_limit", message: "Provider returned a rate limit error." };
    return { code: `http_${err.status}`, message: err.body.slice(0, 300) || `Provider returned ${err.status}.` };
  }
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.toLowerCase().includes("aborted")) {
    return { code: "timeout", message: "Provider did not respond within 10 seconds." };
  }
  return { code: "network", message: raw.slice(0, 300) };
}
