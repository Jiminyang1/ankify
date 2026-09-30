import { NextResponse } from "next/server";
import type { SuggestionFailure } from "./commands";

export function suggestionErrorResponse(failure: SuggestionFailure) {
  const status =
    failure.error === "suggestion_not_found" || failure.error === "problem_not_found"
      ? 404
      : failure.error === "suggestion_limit_reached"
        ? 429
        : failure.error === "problem_limit_reached"
          ? 403
          : failure.error === "workflow_disabled"
            ? 503
            : 409;
  return NextResponse.json(
    { error: failure.error, ...(failure.message ? { message: failure.message } : {}), ...(failure.suggestion ? { suggestion: failure.suggestion } : {}) },
    { status },
  );
}
