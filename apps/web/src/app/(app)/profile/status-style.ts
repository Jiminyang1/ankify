import type { PlanProblemStatus } from "@ankify/core";

/** Left-to-right order in progress bars and legends. */
export const STATUS_ORDER: readonly PlanProblemStatus[] = ["remembered", "due", "solved", "todo"];

/** Bar segment fill; `todo` is the empty track. */
export const STATUS_FILL: Record<PlanProblemStatus, string> = {
  remembered: "bg-success",
  due: "bg-warning",
  solved: "bg-muted/45",
  todo: "",
};

/** Legend and list-row swatch. `todo` is an outline so it reads as empty. */
export const STATUS_SWATCH: Record<PlanProblemStatus, string> = {
  remembered: "bg-success",
  due: "bg-warning",
  solved: "bg-muted/45",
  todo: "border border-muted/60",
};
