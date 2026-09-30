import type { WorkflowId } from "@ankify/contracts";
import { NextResponse } from "next/server";

/**
 * Workflows this server implements. A workflow joins the list only once its
 * API and worker invariants exist and are tested; capabilities never
 * advertise more than this.
 */
const IMPLEMENTED_WORKFLOWS: readonly WorkflowId[] = [
  "capture",
  "legacy_review",
  "coach",
  "card_generation",
  "quiz_generation",
  "credit_checkout",
  "practice_sessions",
  "session_rating",
  "session_analysis",
  "suggestions",
];

/**
 * Operational kill switch: `ANKIFY_DISABLED_WORKFLOWS=practice_sessions,...`
 * turns implemented workflows off without a code change (the plan's rollback
 * lever). Unknown names are ignored.
 */
function disabledWorkflows(): Set<string> {
  return new Set(
    (process.env.ANKIFY_DISABLED_WORKFLOWS ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

export function isWorkflowEnabled(workflow: WorkflowId) {
  return IMPLEMENTED_WORKFLOWS.includes(workflow) && !disabledWorkflows().has(workflow);
}

export function enabledWorkflows(): WorkflowId[] {
  const disabled = disabledWorkflows();
  return IMPLEMENTED_WORKFLOWS.filter((workflow) => !disabled.has(workflow));
}

/**
 * Automatic session analysis additionally needs dispatch recovery on the
 * deployment: a job whose queue message was never sent would otherwise wait
 * for the user's next visit. Operators set `ANKIFY_AUTOMATIC_ANALYSIS=enabled`
 * only after the recovery cron is verified (see DEPLOYMENT.md).
 */
export function isAutomaticAnalysisEnabled() {
  return isWorkflowEnabled("session_analysis") && process.env.ANKIFY_AUTOMATIC_ANALYSIS === "enabled";
}

/** Retired workflows old clients may still call, and how each is retired. */
export const LEGACY_WORKFLOWS: Partial<Record<WorkflowId, { code: "upgrade_required" | "workflow_suspended"; message: string }>> = {
  legacy_review: {
    code: "upgrade_required",
    message: "Update the ankify extension: reviews are now rated after solving the problem on LeetCode.",
  },
  coach: { code: "workflow_suspended", message: "Study Coach is no longer available." },
  card_generation: { code: "workflow_suspended", message: "Card generation is no longer available." },
  quiz_generation: { code: "workflow_suspended", message: "Quiz generation is no longer available." },
  credit_checkout: { code: "workflow_suspended", message: "AI credit purchases are suspended." },
};

/** The structured answer old clients get from a retired workflow's route. */
export function legacyWorkflowResponse(workflow: WorkflowId) {
  const retired = LEGACY_WORKFLOWS[workflow] ?? { code: "workflow_suspended" as const, message: "This feature is no longer available." };
  return NextResponse.json(
    { error: retired.code, workflow, message: retired.message },
    { status: retired.code === "upgrade_required" ? 426 : 410 },
  );
}

export function workflowDisabledResponse() {
  return NextResponse.json(
    { error: "workflow_disabled", message: "This feature is temporarily unavailable." },
    { status: 503 },
  );
}
