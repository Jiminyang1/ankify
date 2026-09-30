import type {
  MistakeCreateRequest,
  MistakeCreateResponseDto,
  MistakePatchInput,
  MistakeRecordDto,
} from "@ankify/contracts";
import { SKILL_DIMENSIONS, type SkillDimension } from "@ankify/core";

export const MISTAKES_CHANGED_EVENT = "ankify:mistakes-changed";

export type MistakesChangedEvent = CustomEvent<{ problemId: string }>;

/** Lets other views of the same problem (e.g. the Mistakes tab) refresh. */
export function notifyMistakesChanged(problemId: string) {
  window.dispatchEvent(new CustomEvent(MISTAKES_CHANGED_EVENT, { detail: { problemId } }));
}

/** Where a mistake came from, minus the fields every record carries. */
export type MistakeSourceRef =
  | { sourceType: "manual" }
  | { sourceType: "submission"; submissionId: string }
  | { sourceType: "quiz_answer"; quizSessionId: string; quizItemId: string }
  | { sourceType: "review"; reviewRequestId: string };

type MistakeResult<T> = ({ ok: true } & T) | { ok: false; error: string };

async function sendJson<T>(url: string, method: string, body?: unknown): Promise<MistakeResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as ({ error?: string } & T) | null;
    if (!res.ok || !json) return { ok: false, error: json?.error ?? `http_${res.status}` };
    return { ok: true, ...json };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

export function createMistakeRequest(input: MistakeCreateRequest) {
  return sendJson<Omit<MistakeCreateResponseDto, "ok">>("/api/mistakes", "POST", input);
}

export function updateMistakeRequest(id: string, patch: MistakePatchInput) {
  return sendJson<{ mistake: MistakeRecordDto }>(`/api/mistakes/${encodeURIComponent(id)}`, "PATCH", patch);
}

export function deleteMistakeRequest(id: string) {
  return sendJson<Record<string, never>>(`/api/mistakes/${encodeURIComponent(id)}`, "DELETE");
}

/** Taxonomy order, optionally moving one category to the front (e.g.
 *  `complexity` for a TLE) without preselecting it. */
export function orderedDimensions(first?: SkillDimension | null): SkillDimension[] {
  if (!first) return [...SKILL_DIMENSIONS];
  return [first, ...SKILL_DIMENSIONS.filter((dimension) => dimension !== first)];
}
