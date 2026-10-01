import { ownerTokenSchema } from "@ankify/contracts";
import { NextResponse } from "next/server";
import type { SessionFailure } from "./store";

/** Tabs identify themselves on reads with this header, so the response can say
 *  whether the session is controlled by the caller or another tab. */
export const OWNER_TOKEN_HEADER = "x-ankify-owner-token";

export function requestOwnerToken(req: Request): string | null {
  const parsed = ownerTokenSchema.safeParse(req.headers.get(OWNER_TOKEN_HEADER));
  return parsed.success ? parsed.data : null;
}

export function sessionErrorResponse(failure: SessionFailure) {
  const status =
    failure.error === "session_not_found" || failure.error === "problem_not_found"
      ? 404
      : failure.error === "problem_limit_reached"
        ? 403
        : failure.error === "workflow_disabled"
          ? 503
          : 409;
  return NextResponse.json(
    {
      error: failure.error,
      ...(failure.message ? { message: failure.message } : {}),
      ...(failure.session ? { session: failure.session } : {}),
      ...(failure.problem ? { problem: failure.problem } : {}),
    },
    { status },
  );
}
