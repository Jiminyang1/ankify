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

export function workflowDisabledResponse() {
  return NextResponse.json(
    { error: "workflow_disabled", message: "This feature is temporarily unavailable." },
    { status: 503 },
  );
}
