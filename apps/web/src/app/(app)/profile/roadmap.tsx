"use client";

import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { cn } from "@/lib/utils";
import type { PlanGroup } from "@/server/profile";
import { GroupDialog } from "./group-dialog";
import { roadmapLayout } from "./roadmap-layout";
import { StatusBar } from "./status-bar";

const ROW_H = 124;
const NODE_W = 168;
const NODE_H = 72;
const NODE_TOP = (ROW_H - NODE_H) / 2;

/** Top Interview 150 as a roadmap on wide screens, a plain ordered list on
 *  narrow ones. Clicking a pattern opens its problem list. */
export function Roadmap({
  planSlug,
  groups,
  nextSlug,
}: {
  planSlug: string;
  groups: PlanGroup[];
  nextSlug: string | null;
}) {
  const [openName, setOpenName] = useState<string | null>(null);
  const layout = roadmapLayout(planSlug, groups.map((group) => group.name));
  const openGroup = groups.find((group) => group.name === openName) ?? null;
  const nextGroup = groups.find((group) => group.items.some((item) => item.slug === nextSlug))?.name ?? null;
  const height = layout.rows * ROW_H;

  // Edges are drawn in real pixels (not a stretched viewBox) so curves and
  // anchor dots keep their shape; wait for the first measurement.
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  type Side = "top" | "bottom" | "left" | "right";
  const anchor = (name: string, side: Side) => {
    const pos = layout.positions.get(name)!;
    const cx = pos.x * width;
    const top = pos.row * ROW_H + NODE_TOP;
    if (side === "left" || side === "right") {
      return { x: cx + (side === "right" ? NODE_W / 2 : -NODE_W / 2), y: top + NODE_H / 2 };
    }
    return { x: cx, y: top + (side === "bottom" ? NODE_H : 0) };
  };
  const endpoints = ({ from, to, kind }: (typeof layout.edges)[number]): [Side, Side] => {
    if (kind === "down") return ["bottom", "top"];
    return layout.positions.get(to)!.x > layout.positions.get(from)!.x ? ["right", "left"] : ["left", "right"];
  };
  // The path into "next up" draws last so its highlight sits on top.
  const edges = [...layout.edges].sort((a, b) => Number(a.to === nextGroup) - Number(b.to === nextGroup));
  const anchors = new Map<string, { x: number; y: number }>();
  for (const edge of layout.edges) {
    const [out, into] = endpoints(edge);
    anchors.set(`${edge.from}:${out}`, anchor(edge.from, out));
    anchors.set(`${edge.to}:${into}`, anchor(edge.to, into));
  }

  return (
    <>
      <div ref={containerRef} className="relative mx-auto hidden max-w-[960px] lg:block" style={{ height }}>
        {width > 0 && (
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0" width={width} height={height}>
            {edges.map((edge) => {
              const [out, into] = endpoints(edge);
              const a = anchor(edge.from, out);
              const b = anchor(edge.to, into);
              const bend = (b.y - a.y) / 2;
              const highlighted = edge.to === nextGroup;
              return (
                <path
                  key={`${edge.from}->${edge.to}`}
                  d={
                    edge.kind === "down"
                      ? `M ${a.x} ${a.y} C ${a.x} ${a.y + bend}, ${b.x} ${b.y - bend}, ${b.x} ${b.y}`
                      : `M ${a.x} ${a.y} L ${b.x} ${b.y}`
                  }
                  fill="none"
                  strokeLinecap="round"
                  strokeWidth={highlighted ? 2 : 1.5}
                  className={highlighted ? "stroke-accent/80" : "stroke-border"}
                />
              );
            })}
            {[...anchors].map(([key, point]) => (
              <circle
                key={key}
                cx={point.x}
                cy={point.y}
                r={3}
                strokeWidth={1.5}
                className="fill-surface stroke-border"
              />
            ))}
          </svg>
        )}
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
        <span className={cn("inline-flex items-center gap-1 tabular-nums", done === total ? "text-success" : "text-muted")}>
          {done === total && <Check aria-hidden="true" className="h-3 w-3" strokeWidth={3} />}
          {done}/{total}
        </span>
        {group.counts.due > 0 && <span className="font-medium text-warning">{copy.nodeDue(group.counts.due)}</span>}
        {isNext && <span className="font-medium text-accent">{copy.nextUp}</span>}
      </span>
    </button>
  );
}
