import type { PracticeSessionDto, PublicAiJobDto } from "@ankify/contracts";

export const AGENT_JOB_UPDATED_EVENT = "ankify:agent-job-updated";

export type AgentJobUpdatedEvent = CustomEvent<PublicAiJobDto>;

export function notifyAgentJobUpdated(job: PublicAiJobDto) {
  window.dispatchEvent(new CustomEvent(AGENT_JOB_UPDATED_EVENT, { detail: job }));
}

/** A problem's Notes, Cards, or Solutions changed (a Coach edit was applied). */
export const PROBLEM_DOCS_UPDATED_EVENT = "ankify:problem-docs-updated";

export function notifyProblemDocsUpdated(problemId: string) {
  window.dispatchEvent(new CustomEvent(PROBLEM_DOCS_UPDATED_EVENT, { detail: { problemId } }));
}

/** A problem's weak spots changed (recorded, removed, resolved). */
export const WEAKNESSES_UPDATED_EVENT = "ankify:weaknesses-updated";

export function notifyWeaknessesUpdated(problemId: string | null) {
  window.dispatchEvent(new CustomEvent(WEAKNESSES_UPDATED_EVENT, { detail: { problemId } }));
}

/** A practice session changed: a reply was judged, it finished, or it was rated. */
export const PRACTICE_UPDATED_EVENT = "ankify:practice-updated";

export type PracticeUpdatedEvent = CustomEvent<PracticeSessionDto>;

export function notifyPracticeUpdated(session: PracticeSessionDto) {
  window.dispatchEvent(new CustomEvent(PRACTICE_UPDATED_EVENT, { detail: session }));
}
