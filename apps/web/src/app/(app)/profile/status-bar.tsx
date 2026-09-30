import type { PlanProblemStatus } from "@ankify/core";
import { cn } from "@/lib/utils";
import { STATUS_FILL, STATUS_ORDER } from "./status-style";

/** Stacked progress bar: remembered, due, solved, then the empty track. */
export function StatusBar({
  counts,
  total,
  className,
}: {
  counts: Record<PlanProblemStatus, number>;
  total: number;
  className?: string;
}) {
  return (
    <div aria-hidden="true" className={cn("flex overflow-hidden rounded-full bg-border/70", className)}>
      {STATUS_ORDER.filter((status) => status !== "todo" && counts[status] > 0).map((status) => (
        <div key={status} className={STATUS_FILL[status]} style={{ width: `${(counts[status] / total) * 100}%` }} />
      ))}
    </div>
  );
}
