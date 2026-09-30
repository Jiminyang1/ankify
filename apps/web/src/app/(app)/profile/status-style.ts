import type { PlanProblemStatus } from "@ankify/core";

export const STATUS_ORDER: readonly PlanProblemStatus[] = ["mastered", "learning", "fading", "solved", "todo"];

/** Square fill per status. `solved` is dashed: done, but outside your reviews. */
export const STATUS_SQUARE: Record<PlanProblemStatus, string> = {
  mastered: "bg-success",
  learning: "bg-success/50",
  fading: "bg-warning",
  solved: "border border-dashed border-muted",
  todo: "bg-border",
};

/** Segment fill for the overall progress bar; `todo` is the empty track. */
export const STATUS_BAR: Record<PlanProblemStatus, string> = {
  mastered: "bg-success",
  learning: "bg-success/50",
  fading: "bg-warning",
  solved: "bg-muted/35",
  todo: "",
};
