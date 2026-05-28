"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";

export function DashboardCharts({
  dailyReviews,
}: {
  dailyReviews: { day: string; count: number }[];
}) {
  const total = dailyReviews.reduce((sum, d) => sum + d.count, 0);
  const activeDays = dailyReviews.filter((d) => d.count > 0).length;
  const avgPerActiveDay = activeDays > 0 ? Math.round((total / activeDays) * 10) / 10 : 0;

  return (
    <ChartFrame
      title="Review activity"
      subtitle="Problems you rated each day over the last 30 days."
      meta={total > 0 ? `${total} reviews · ${avgPerActiveDay}/active day` : undefined}
    >
      {total === 0 ? (
        <div className="flex h-[200px] items-center justify-center text-sm text-muted">
          No reviews in the last 30 days.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={dailyReviews} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgb(var(--border))"
              vertical={false}
            />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 10, fill: "rgb(var(--muted))" }}
              tickFormatter={formatDay}
              tickLine={false}
              axisLine={{ stroke: "rgb(var(--border))" }}
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "rgb(var(--muted))" }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={32}
            />
            <Tooltip
              cursor={{ fill: "rgb(var(--subtle))" }}
              content={<ThemedTooltip />}
            />
            <Bar
              dataKey="count"
              fill="rgb(var(--accent))"
              radius={[3, 3, 0, 0]}
              maxBarSize={28}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}

/** "2026-05-28" -> "05/28" */
function formatDay(value: string): string {
  const parts = value.split("-");
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : value;
}

function ThemedTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const count = payload[0]?.value ?? 0;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-card-hover">
      <div className="font-medium text-fg">{typeof label === "string" ? formatDay(label) : label}</div>
      <div className="mt-0.5 text-muted">
        {count} review{count === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function ChartFrame({
  title,
  subtitle,
  meta,
  children,
}: {
  title: string;
  subtitle?: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {meta && <span className="shrink-0 text-xs text-muted tabular-nums">{meta}</span>}
      </div>
      {children}
    </div>
  );
}
