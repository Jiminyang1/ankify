"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function DashboardCharts({
  dailyReviews,
}: {
  dailyReviews: { day: string; count: number }[];
}) {
  return (
    <div className="grid gap-6">
      <ChartFrame title="Reviews / day (last 30d)">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={dailyReviews}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
            <XAxis dataKey="day" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="count" fill="rgb(var(--accent))" />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}

function ChartFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </div>
  );
}
