import { NextResponse } from "next/server";
import { aiJobCreateRequestSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import {
  AiJobRequestError,
  listOwnedAiJobs,
  toPublicAiJob,
} from "@/server/ai-generation/jobs";
import { startAiJobForUser } from "@/server/ai-generation/start";

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const body = await req.json().catch(() => null);
  const parsed = aiJobCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const job = await startAiJobForUser(user.id, parsed.data);
    return NextResponse.json(
      { ok: true, job: toPublicAiJob(job) },
      { status: job.status === "queued" || job.status === "running" ? 202 : 200 },
    );
  } catch (error) {
    return jobRequestErrorResponse(error);
  }
}

export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const url = new URL(req.url);
  const problemId = url.searchParams.get("problemId")?.trim();
  const kindParam = url.searchParams.get("kind");
  if (!problemId || (kindParam !== null && kindParam !== "card" && kindParam !== "quiz")) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }
  const jobs = await listOwnedAiJobs({
    userId: user.id,
    problemId,
    kind: kindParam ?? undefined,
    activeOnly: url.searchParams.get("active") === "true",
  });
  return NextResponse.json({ ok: true, jobs: jobs.map(toPublicAiJob) });
}

function jobRequestErrorResponse(error: unknown) {
  if (error instanceof AiJobRequestError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      {
        status: error.status,
        headers: error.retryAfterSec
          ? { "Retry-After": String(error.retryAfterSec) }
          : undefined,
      },
    );
  }
  console.error("[ai-job] request failed", error);
  return NextResponse.json(
    { error: "ai_job_request_failed", message: "Could not start AI generation." },
    { status: 500 },
  );
}
