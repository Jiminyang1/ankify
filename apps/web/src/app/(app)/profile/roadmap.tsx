"use client";

import { useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { cn } from "@/lib/utils";
import type { PlanGroup } from "@/server/profile";
import { GroupDialog } from "./group-dialog";
import { roadmapLayout } from "./roadmap-layout";
import { StatusBar } from "./status-bar";

const ROW_H = 104;
const NODE_W = 168;
const NODE_H = 72;
const NODE_TOP = (ROW_H - NODE_H) / 2;
/** SVG x units; the overlay stretches horizontally to the container. */
const VIEW_W = 1000;

/** Top Interview 150 as a roadmap on wide screens, a plain ordered list on
 *  narrow ones. Clicking a pattern opens its problem list. */
export function Roadmap({ groups, nextSlug }: { groups: PlanGroup[]; nextSlug: string | null }) {
  const [openName, setOpenName] = useState<string | null>(null);
  const layout = roadmapLayout(groups.map((group) => group.name));
  const openGroup = groups.find((group) => group.name === openName) ?? null;
  const nextGroup = groups.find((group) => group.items.some((item) => item.slug === nextSlug))?.name ?? null;

  return (
    <>
      <div className="relative hidden lg:block" style={{ height: layout.rows * ROW_H }}>
        <svg
          aria-hidden="true"
          className="absolute inset-0 h-full w-full text-border"
          viewBox={`0 0 ${VIEW_W} ${layout.rows * ROW_H}`}
          preserveAspectRatio="none"
        >
          {layout.edges.map(([from, to]) => {
            const a = layout.positions.get(from)!;
            const b = layout.positions.get(to)!;
            return (
              <line
                key={`${from}->${to}`}
                x1={a.x * VIEW_W}
                y1={a.row * ROW_H + NODE_TOP + NODE_H}
                x2={b.x * VIEW_W}
                y2={b.row * ROW_H + NODE_TOP}
                stroke="currentColor"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
        {groups.map((group) => {
          const pos = layout.positions.get(group.name)!;
          return (
            <RoadmapNode
              key={group.name}
              group={group}
              isNext={group.name === nextGroup}
              onOpen={() => setOpenName(group.name)}
              className="absolute"
              style={{
                left: `calc(${pos.x * 100}% - ${NODE_W / 2}px)`,
                top: pos.row * ROW_H + NODE_TOP,
                width: NODE_W,
                height: NODE_H,
              }}
            />
          );
        })}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:hidden">
        {groups.map((group) => (
          <RoadmapNode
            key={group.name}
            group={group}
            isNext={group.name === nextGroup}
            onOpen={() => setOpenName(group.name)}
          />
        ))}
      </div>

      {openGroup && <GroupDialog group={openGroup} nextSlug={nextSlug} onClose={() => setOpenName(null)} />}
    </>
  );
}

function RoadmapNode({
  group,
  isNext,
  onOpen,
  className,
  style,
}: {
  group: PlanGroup;
  isNext: boolean;
  onOpen: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { t } = useLanguage();
  const copy = t.profile;
  const total = group.items.length;
  const done = total - group.counts.todo;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={copy.openGroup(group.name)}
      style={style}
      className={cn(
        "flex flex-col justify-center rounded-xl border bg-surface px-3 py-2.5 text-left shadow-card transition hover:-translate-y-px hover:border-accent/40 hover:shadow-card-hover",
        isNext ? "border-accent/60 ring-2 ring-accent/25" : "border-border",
        className,
      )}
    >
      <span className="truncate text-[13px] font-medium">{group.name}</span>
      <StatusBar counts={group.counts} total={total} className="mt-2 h-1.5" />
      <span className="mt-1.5 flex h-4 items-center gap-2 text-[11px]">
        <span className="tabular-nums text-muted">
          {done}/{total}
        </span>
        {group.counts.due > 0 && <span className="font-medium text-warning">{copy.nodeDue(group.counts.due)}</span>}
        {isNext && <span className="font-medium text-accent">{copy.nextUp}</span>}
      </span>
    </button>
  );
}
