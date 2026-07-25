import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

export const AI_TIMEOUT_CODE = "ai_timeout";

export function isAiTimeoutError(err: unknown) {
  if (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") return true;
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return err.name === "AbortError" || message.includes("aborted") || message.includes("timeout");
}

export function aiRouteErrorResponse(
  err: unknown,
  opts: { label: string; timeoutMs: number; logPrefix: string },
) {
  const errorId = randomUUID();
  console.error(opts.logPrefix, { errorId, ...safeErrorForLog(err) });

  if (isAiTimeoutError(err)) {
    const seconds = Math.round(opts.timeoutMs / 1000);
    return NextResponse.json(
      {
        error: AI_TIMEOUT_CODE,
        message: `${opts.label} did not finish within ${seconds} seconds. Try Fast mode in Settings or retry.`,
        retryable: true,
        errorId,
      },
      { status: 504 },
    );
  }

  const known = knownConfigurationError(err);
  if (known) {
    return NextResponse.json({ ...known.body, errorId }, { status: known.status });
  }

  return NextResponse.json(
    {
      error: "ai_generation_failed",
      message: `${opts.label} failed. Check the provider, model, and API key, then retry.`,
      retryable: true,
      errorId,
    },
    { status: 502 },
  );
}

export function safeErrorForLog(err: unknown) {
  if (!(err instanceof Error)) return { type: typeof err };
  const details = err as Error & {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  return {
    name: err.name,
    code:
      typeof details.code === "string" || typeof details.code === "number"
        ? details.code
        : undefined,
    status:
      typeof details.status === "string" || typeof details.status === "number"
        ? details.status
        : typeof details.statusCode === "string" ||
            typeof details.statusCode === "number"
          ? details.statusCode
          : undefined,
  };
}

function knownConfigurationError(err: unknown) {
  const message = err instanceof Error ? err.message : "";
  if (message.startsWith("AI_NOT_CONFIGURED")) {
    return {
      status: 400,
      body: {
        error: "ai_not_configured",
        message: "Configure an AI provider and model in Settings.",
        retryable: false,
      },
    };
  }
  if (message.startsWith("AI_KEY_MISSING")) {
    return {
      status: 400,
      body: {
        error: "ai_key_missing",
        message: "Add your provider API key in Settings.",
        retryable: false,
      },
    };
  }
  return null;
}
