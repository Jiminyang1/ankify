"use client";

import { useState } from "react";
import type { ProblemDocsDto } from "@ankify/contracts";
import { useLanguage } from "@/components/LanguageProvider";
import { useAgentPageContext } from "@/components/agent/agent-shell";
import { ProblemDocs, type DocTarget } from "@/components/problem-docs";
import { cn } from "@/lib/utils";

export type WorkspacePanel = {
  id: string;
  label: string;
  count?: number;
  /** A doc tab: the one shared ProblemDocs shows this doc. */
  doc?: DocTarget;
  node?: React.ReactNode;
  /** Fills the panel edge to edge (it has its own toolbar and scrolling). */
  flush?: boolean;
};

/**
 * Tabbed "management console" body for the problem detail page. All panels are
 * rendered up front and toggled with `hidden` so client state inside a panel
 * (e.g. card selection) survives tab switches. Server-rendered nodes (Markdown,
 * highlighted code) are passed in as `node`. The Notes / Cards / Solutions
 * tabs share one ProblemDocs, whose Edit / Save sit at the end of the tab row.
 */
export function ProblemWorkspace({
  panels,
  defaultTab,
  docs,
  problemId,
  problemTitle,
}: {
  panels: WorkspacePanel[];
  defaultTab?: string;
  docs: ProblemDocsDto;
  problemId: string;
  problemTitle: string;
}) {
  const { t } = useLanguage();
  const [active, setActive] = useState(defaultTab ?? panels[0]?.id);
  const [docActions, setDocActions] = useState<HTMLDivElement | null>(null);
  const activeDoc = panels.find((p) => p.id === active)?.doc;
  const activePanel =
    active === "notes" || active === "cards" || active === "submissions" || active === "weak_spots"
      ? active
      : active === "solutions"
        ? "docs"
        : "overview";
  useAgentPageContext({
    problemId,
    problemTitle,
    page: "problem",
    activePanel,
  });

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabButtons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    const currentIndex = tabButtons.indexOf(event.target as HTMLButtonElement);
    if (currentIndex < 0 || tabButtons.length === 0) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabButtons.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabButtons.length) %
            tabButtons.length;
    const next = tabButtons[nextIndex];
    next?.focus();
    next?.click();
  };

  return (
    <section className="flex h-[42rem] max-h-[calc(100vh-3rem)] min-h-[28rem] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div className="flex shrink-0 items-center gap-2 border-b border-border pr-3">
        <div
          role="tablist"
          aria-label={t.detail.problemContent}
          onKeyDown={moveFocus}
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-2"
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
        <div ref={setDocActions} className={cn("shrink-0", !activeDoc && "hidden")} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          role="tabpanel"
          id={activeDoc ? `panel-${activeDoc}` : undefined}
          aria-labelledby={activeDoc ? `tab-${activeDoc}` : undefined}
          hidden={!activeDoc}
          className="h-full"
        >
          <ProblemDocs
            problemId={problemId}
            initialDocs={docs}
            target={activeDoc ?? "notes"}
            actionsSlot={docActions}
            className="h-full"
          />
        </div>
        {panels.filter((p) => !p.doc).map((p) => (
          <div
            key={p.id}
            id={`panel-${p.id}`}
            role="tabpanel"
            aria-labelledby={`tab-${p.id}`}
            hidden={p.id !== active}
            className={p.flush ? "h-full" : "p-4 sm:p-5"}
          >
            {p.node}
          </div>
        ))}
      </div>
    </section>
  );
}
