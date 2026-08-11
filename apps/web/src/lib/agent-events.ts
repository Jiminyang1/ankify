import type { PublicAiJobDto } from "@ankify/contracts";

export const AGENT_JOB_UPDATED_EVENT = "ankify:agent-job-updated";

export type AgentJobUpdatedEvent = CustomEvent<PublicAiJobDto>;

export function notifyAgentJobUpdated(job: PublicAiJobDto) {
  window.dispatchEvent(new CustomEvent(AGENT_JOB_UPDATED_EVENT, { detail: job }));
}
