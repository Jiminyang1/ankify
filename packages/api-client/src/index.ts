import type { AiJobCreateRequestInput, PublicAiJobDto } from "@ankify/contracts";

type ApiRequest = (path: string, init?: RequestInit) => Promise<Response>;

type ApiPayload = {
  error?: string;
  message?: string;
  job?: PublicAiJobDto;
  jobs?: PublicAiJobDto[];
};

const terminalStatuses = new Set<PublicAiJobDto["status"]>([
  "succeeded",
  "failed",
  "cancelled",
  "superseded",
]);

async function readPayload(response: Response): Promise<ApiPayload | null> {
  return response.json().catch(() => null) as Promise<ApiPayload | null>;
}

function responseError(response: Response, payload: ApiPayload | null): Error {
  return new Error(payload?.message ?? payload?.error ?? `HTTP ${response.status}`);
}

export function createAiJobClient(request: ApiRequest) {
  async function start(input: AiJobCreateRequestInput): Promise<PublicAiJobDto> {
    const response = await request("/api/ai-jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = await readPayload(response);
    if (!response.ok || !payload?.job) throw responseError(response, payload);
    return payload.job;
  }

  async function get(jobId: string): Promise<PublicAiJobDto> {
    const response = await request(`/api/ai-jobs/${jobId}`, { cache: "no-store" });
    const payload = await readPayload(response);
    if (!response.ok || !payload?.job) throw responseError(response, payload);
    return payload.job;
  }

  async function listActive(
    problemId: string,
    kind: "card" | "quiz",
  ): Promise<PublicAiJobDto[]> {
    const params = new URLSearchParams({ problemId, kind, active: "true" });
    const response = await request(`/api/ai-jobs?${params}`, { cache: "no-store" });
    const payload = await readPayload(response);
    if (!response.ok) throw responseError(response, payload);
    return payload?.jobs ?? [];
  }

  async function getActive(
    problemId: string,
    kind: "card" | "quiz",
  ): Promise<PublicAiJobDto | null> {
    return (await listActive(problemId, kind))[0] ?? null;
  }

  async function wait(initial: PublicAiJobDto): Promise<PublicAiJobDto> {
    let job = initial;
    while (!terminalStatuses.has(job.status)) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      job = await get(job.id);
    }
    return job;
  }

  function requireSucceeded(job: PublicAiJobDto): PublicAiJobDto {
    if (job.status !== "succeeded") {
      throw new Error(job.errorMessage ?? job.errorCode ?? "AI generation failed.");
    }
    return job;
  }

  return { start, listActive, getActive, wait, requireSucceeded };
}
