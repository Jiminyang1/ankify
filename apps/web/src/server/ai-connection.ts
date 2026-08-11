import { generateText, Output, tool } from "ai";
import { z } from "zod";
import type { AiProvider } from "@ankify/core";
import { buildModel } from "./ai";
import { safeErrorForLog } from "./ai-errors";
import { markAiVerified } from "./onboarding";
import { decryptSecret } from "./secret-box";
import { getAiSettings, setAiSettings } from "./settings";

const probeSchema = z.object({ ok: z.literal(true) });

type TestAiConnectionInput = {
  provider?: Exclude<AiProvider, "">;
  model?: string;
  apiKey?: string;
  saveOnSuccess?: boolean;
};

type MissingConfigurationResult = {
  ok: false;
  code: "missing_provider" | "missing_model" | "missing_api_key";
};

type TestAiConnectionResult =
  | MissingConfigurationResult
  | {
      ok: true;
      provider: Exclude<AiProvider, "">;
      model: string;
      saved: boolean;
      latencyMs: number;
    }
  | {
      ok: false;
      code: string;
      message: string;
      provider: Exclude<AiProvider, "">;
      model: string;
      latencyMs: number;
    };

export async function testAiConnection(
  userId: string,
  input: TestAiConnectionInput,
): Promise<TestAiConnectionResult> {
  const stored = await getAiSettings(userId);
  const provider = input.provider ?? (stored.provider || undefined);
  const model = input.model ?? (stored.model || undefined);
  const apiKey =
    input.apiKey ??
    (provider === stored.provider && stored.encryptedApiKey
      ? safeDecrypt(stored.encryptedApiKey)
      : undefined);

  if (!provider) return { ok: false, code: "missing_provider" };
  if (!model) return { ok: false, code: "missing_model" };
  if (!apiKey) return { ok: false, code: "missing_api_key" };

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 175_000);

  try {
    const llm = buildModel({ provider, model, apiKey }, { disableThinking: true });
    await generateText({
      model: llm,
      output: Output.object({ schema: probeSchema }),
      system: "You are a connection probe. Respond with {\"ok\": true}.",
      prompt: 'Respond with the JSON object {"ok": true} and nothing else.',
      temperature: 0,
      abortSignal: controller.signal,
    });
    const toolProbe = await generateText({
      model: llm,
      prompt: "Call confirm_connection with ok=true.",
      tools: {
        confirm_connection: tool({
          description: "Confirm that this model supports tool calling.",
          inputSchema: probeSchema,
          execute: async ({ ok }) => ({ ok }),
        }),
      },
      toolChoice: { type: "tool", toolName: "confirm_connection" },
      temperature: 0,
      abortSignal: controller.signal,
    });
    if (toolProbe.toolResults.length !== 1) throw new Error("tool_call_not_supported");

    if (input.saveOnSuccess) {
      await setAiSettings(userId, {
        provider,
        model,
        reasoningMode: provider === stored.provider ? stored.reasoningMode : "fast",
        apiKey: input.apiKey,
      });
      await markAiVerified(userId);
    } else if (
      input.apiKey === undefined &&
      provider === stored.provider &&
      model === stored.model &&
      stored.encryptedApiKey
    ) {
      await markAiVerified(userId);
    }

    return {
      ok: true,
      provider,
      model,
      saved: Boolean(input.saveOnSuccess),
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    console.warn("[ai-test] provider probe failed", safeErrorForLog(error));
    return {
      ok: false,
      ...classifyAiError(error),
      provider,
      model,
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

function safeDecrypt(
  envelope: NonNullable<Awaited<ReturnType<typeof getAiSettings>>["encryptedApiKey"]>,
) {
  try {
    return decryptSecret(envelope);
  } catch {
    return undefined;
  }
}

function classifyAiError(error: unknown): { code: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  if (lower.includes("aborted") || lower.includes("timeout")) {
    return { code: "timeout", message: "Provider did not respond within 3 minutes." };
  }
  if (
    lower.includes("401") ||
    lower.includes("unauthorized") ||
    lower.includes("invalid api key") ||
    lower.includes("authentication")
  ) {
    return { code: "invalid_api_key", message: "API key was rejected by the provider." };
  }
  if (lower.includes("403") || lower.includes("forbidden") || lower.includes("permission")) {
    return { code: "forbidden", message: "API key does not have access to this model." };
  }
  if (
    lower.includes("404") ||
    lower.includes("not found") ||
    lower.includes("model_not_found") ||
    lower.includes("does not exist")
  ) {
    return { code: "model_not_found", message: "Model id was not recognized by the provider." };
  }
  if (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("quota") ||
    lower.includes("insufficient")
  ) {
    return { code: "quota_or_rate_limit", message: "Provider returned a rate limit or quota error." };
  }
  if (
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("enotfound") ||
    lower.includes("econnrefused")
  ) {
    return { code: "network", message: "Could not reach the provider." };
  }
  return {
    code: "unknown",
    message: "The provider rejected the test or returned an unexpected response.",
  };
}
