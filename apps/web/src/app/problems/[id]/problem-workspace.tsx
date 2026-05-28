"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type WorkspacePanel = {
  id: string;
  label: string;
  count?: number;
  node: React.ReactNode;
};

/**
 * Tabbed "management console" body for the problem detail page. All panels are
 * rendered up front and toggled with `hidden` so client state inside a panel
 * (e.g. card selection) survives tab switches. Server-rendered nodes (Markdown,
 * highlighted code) are passed in as `node`.
 */
export function ProblemWorkspace({
  panels,
  defaultTab,
}: {
  panels: WorkspacePanel[];
  defaultTab?: string;
}) {
  const [active, setActive] = useState(defaultTab ?? panels[0]?.id);

  return (
    <section className="flex h-[42rem] max-h-[calc(100vh-3rem)] min-h-[28rem] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div
        role="tablist"
        aria-label="Problem content"
        className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-2"
      >
        {panels.map((p) => {
          const selected = p.id === active;
          return (
            <button
              key={p.id}
              id={`tab-${p.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`panel-${p.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(p.id)}
              className={cn(
                "relative shrink-0 px-3.5 py-3 text-sm font-medium transition-colors",
                selected ? "text-fg" : "text-muted hover:text-fg",
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                {p.label}
                {p.count != null && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums leading-none",
                      selected ? "bg-accent/15 text-accent" : "bg-subtle text-muted",
                    )}
                  >
                    {p.count}
                  </span>
                )}
              </span>
              {selected && (
                <span aria-hidden className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {panels.map((p) => (
          <div
            key={p.id}
            id={`panel-${p.id}`}
            role="tabpanel"
            aria-labelledby={`tab-${p.id}`}
            hidden={p.id !== active}
            className="p-4 sm:p-5"
          >
            {p.node}
          </div>
        ))}
      </div>
    </section>
  );
}
