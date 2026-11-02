"use client";

import type { PlanStatusEntryDto } from "@ankify/contracts";
import type { PlanCatalogNode, PlanCatalogTag } from "@ankify/core/plan-catalog";
import { ChevronRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { createContext, memo, useContext } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { Pill } from "@/components/ui/pill";
import { Spinner } from "@/components/ui/spinner";
import { translateDifficulty } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { PlanMapNode } from "./plan-map-layout";
import {
  PLAN_BLOCK_TAG,
  planNodeNumber,
  planProblemUrl,
  planSectionHref,
  ratingTone,
  type PlanIndex,
  type PlanNodeState,
  type PlanOnly,
  type PlanSite,
} from "./plan-map-model";

const DIFFICULTY_TONE = { Easy: "text-easy", Medium: "text-medium", Hard: "text-hard" } as const;

/** What every node needs and rarely changes, so a node's own props stay small
 *  and a tick redraws only its node. */
export type PlanMapNodeContext = {
  index: PlanIndex;
  /** Rows per node, without statuses. */
  shape: ReadonlyMap<string, PlanNodeState>;
  site: PlanSite;
  only: PlanOnly;
  currentPlan: string;
  switching: string | null;
  onTick: (slug: string, done: boolean) => void;
  onSetPlan: (plan: string) => void;
  onToggle: (entry: PlanMapNode) => void;
};

const NodeContext = createContext<PlanMapNodeContext | null>(null);
export const PlanMapNodeProvider = NodeContext.Provider;

function useNodeContext() {
  const value = useContext(NodeContext);
  if (!value) throw new Error("map node outside the map");
  return value;
}

const NODE = "absolute rounded-lg border border-border bg-surface";
const CHIP =
  "pointer-events-auto relative inline-flex min-w-0 items-center rounded-full border border-border px-1.5 py-px text-[10px] leading-4 text-muted transition-colors hover:border-accent/40 hover:text-fg";
const EXTERNAL = "pointer-events-auto relative whitespace-nowrap text-[11px] text-accent hover:underline";

function marks(hit: boolean, dim: boolean) {
  return cn(hit && "z-10 ring-2 ring-accent", dim && "opacity-40");
}

const position = (entry: PlanMapNode) => ({ left: entry.x, top: entry.y, width: entry.w, height: entry.h });

/** The tags worth showing on a problem here: NC150 sits inside NC250, so it
 *  stands for both, and a list's own tag says nothing on its own rows. */
function compactTags(tags: readonly PlanCatalogTag[], blockId: string | null): PlanCatalogTag[] {
  const hidden = blockId ? PLAN_BLOCK_TAG[blockId] : undefined;
  const shown: PlanCatalogTag[] = [];
  if (tags.includes("nc150")) shown.push("nc150");
  else if (tags.includes("nc250") && hidden !== "nc250") shown.push("nc250");
  if (tags.includes("hot100") && hidden !== "hot100") shown.push("hot100");
  if (tags.includes("top150") && hidden !== "top150") shown.push("top150");
  return shown;
}

export const PlanMapProblemNode = memo(function PlanMapProblemNode({
  entry,
  status,
  hit,
  dim,
}: {
  entry: PlanMapNode;
  status: PlanStatusEntryDto | undefined;
  hit: boolean;
  dim: boolean;
}) {
  const { language, t } = useLanguage();
  const copy = t.planMap;
  const { index, site, onTick } = useNodeContext();
  const problem = index.catalog.problems[entry.slug!];
  if (!problem) return null;
  const primary = language === "zh" ? problem.zh : problem.en || problem.zh;
  const secondary = language === "zh" && problem.en !== problem.zh ? problem.en : "";
  const done = status != null;
  const auto = status?.auto === true;

  return (
    <div
      style={position(entry)}
      className={cn(NODE, "flex items-center gap-1.5 rounded-md px-2", marks(hit, dim))}
    >
      <span className="flex items-center" title={auto ? copy.row.autoTick : undefined}>
        <input
          type="checkbox"
          checked={done}
          disabled={auto}
          aria-label={copy.row.tick(primary)}
          onChange={(event) => onTick(problem.slug, event.target.checked)}
          className="size-3.5 cursor-pointer accent-[rgb(var(--accent))] disabled:cursor-not-allowed"
        />
      </span>
      <span className="w-10 shrink-0 truncate text-[11px] tabular-nums text-muted" title={problem.label}>
        {problem.label}
      </span>
      <a
        href={planProblemUrl(problem, site)}
        target="_blank"
        rel="noreferrer"
        draggable={false}
        title={secondary ? `${primary} · ${secondary}` : primary}
        className={cn(
          "min-w-0 flex-1 truncate text-[13px] hover:text-accent hover:underline",
          done && "text-muted line-through decoration-border",
        )}
      >
        {primary}
      </a>
      {entry.lessonRole && (
        <Pill compact tone={entry.lessonRole === "worked" ? "accent" : "neutral"}>
          {copy.map[entry.lessonRole]}
        </Pill>
      )}
      {compactTags(problem.tags, entry.blockId).map((tag) => (
        <Pill key={tag} compact>
          {copy.tags[tag]}
        </Pill>
      ))}
      {problem.premium && (
        <Pill compact tone="warning">
          {copy.tags.premium}
        </Pill>
      )}
      {problem.cnOnly && (
        <Pill compact tone="accent">
          {copy.tags.cnOnly}
        </Pill>
      )}
      {problem.rating != null ? (
        <span className={cn("shrink-0 text-[11px] tabular-nums", ratingTone(problem.rating))} title={copy.map.rating(problem.rating)}>
          {problem.rating}
        </span>
      ) : problem.difficulty ? (
        <span className={cn("shrink-0 text-[11px]", DIFFICULTY_TONE[problem.difficulty])} title={copy.map.noRating}>
          {translateDifficulty(language, problem.difficulty)}
        </span>
      ) : null}
    </div>
  );
});

function SectionChips({ node }: { node: PlanCatalogNode }) {
  const { language, t } = useLanguage();
  const copy = t.planMap.section;
  const { index } = useNodeContext();
  const parent = index.nodes.get(index.parents.get(node.id) ?? "");
  const sourceSize = node.source ? (index.subtree.get(node.source)?.length ?? 0) : 0;
  const refTarget = node.ref ? index.nodes.get(node.ref) : undefined;
  const via = node.via ? index.nodes.get(node.via) : undefined;
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden pl-[18px]">
      {node.optional && !parent?.optional && <Pill compact>{copy.optional}</Pill>}
      {via && <Pill compact>{copy.via(via.title[language])}</Pill>}
      {refTarget && (
        <Link href={planSectionHref(refTarget.id) as Route} draggable={false} className={CHIP}>
          <span className="truncate">{copy.see(refTarget.title[language])}</span>
        </Link>
      )}
      {node.source && node.children.length === 0 && sourceSize > node.problems.length && (
        <Link href={planSectionHref(node.source) as Route} draggable={false} className={cn(CHIP, "shrink-0")}>
          {copy.inFullList(sourceSize)}
        </Link>
      )}
      {(node.videos ?? []).map((videoId) => {
        const video = index.nodes.get(videoId);
        return video?.videoUrl ? (
          <a
            key={videoId}
            href={video.videoUrl}
            target="_blank"
            rel="noreferrer"
            draggable={false}
            title={copy.videoChip(video.title[language])}
            aria-label={copy.videoChip(video.title[language])}
            className={cn(CHIP, "shrink-0")}
          >
            {t.planMap.tags.video}
          </a>
        ) : null;
      })}
    </span>
  );
}

function StepRow({ node }: { node: PlanCatalogNode }) {
  const { t } = useLanguage();
  const copy = t.planMap.section;
  const { index } = useNodeContext();
  const deepDive = node.deepDive ? index.planNode.get(node.deepDive) : undefined;
  return (
    <span className="flex min-w-0 items-center gap-1 pl-[18px]">
      {node.stepCap != null && <Pill compact>{copy.capChip(node.stepCap)}</Pill>}
      {deepDive && (
        <Link href={planSectionHref(deepDive.id) as Route} draggable={false} className={cn(CHIP, "shrink-0")}>
          {copy.fullList}
        </Link>
      )}
      {node.url && (
        <a href={node.url} target="_blank" rel="noreferrer" draggable={false} className={EXTERNAL}>
          {copy.openPrimer}
        </a>
      )}
    </span>
  );
}

function LessonRow({ node }: { node: PlanCatalogNode }) {
  const { t } = useLanguage();
  const copy = t.planMap.map;
  const { shape } = useNodeContext();
  const state = shape.get(node.id);
  return (
    <span className="flex min-w-0 items-center justify-between gap-2 pl-[18px]">
      <span className="truncate text-[11px] tabular-nums text-muted">
        {copy.lessonCounts(state?.rows.length ?? 0, state?.homework.length ?? 0)}
      </span>
      {node.videoUrl && (
        <a href={node.videoUrl} target="_blank" rel="noreferrer" draggable={false} className={EXTERNAL}>
          {copy.bilibili}
        </a>
      )}
    </span>
  );
}

/** A list's second row: what it is, and making it the current plan. */
function ListRow({ node }: { node: PlanCatalogNode }) {
  const { t } = useLanguage();
  const copy = t.planMap;
  const { only, currentPlan, switching, onSetPlan } = useNodeContext();
  const blurb = node.kind === "dictionary" ? copy.categories.dictionary : copy.blurbs[node.id as keyof typeof copy.blurbs];
  const plan = (only === "nc150" ? node.tagPlans?.nc150 : undefined) ?? node.plan;
  return (
    <span className="flex min-w-0 items-center justify-between gap-2 pl-[18px]">
      <span className="min-w-0 truncate text-[11px] text-muted" title={blurb}>
        {blurb}
      </span>
      {plan &&
        (plan === currentPlan ? (
          <Pill compact tone="accent">
            {copy.block.current}
          </Pill>
        ) : (
          <button
            type="button"
            disabled={switching != null}
            onClick={() => onSetPlan(plan)}
            className="pointer-events-auto relative inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-accent hover:underline disabled:opacity-50"
          >
            {switching === plan && <Spinner />}
            {copy.block.setCurrent}
          </button>
        ))}
    </span>
  );
}

const SHELL: Partial<Record<PlanMapNode["kind"], string>> = {
  root: "justify-center border-fg bg-fg px-3 text-bg",
  group: "justify-center bg-subtle px-2.5",
  block: "border-l-4 border-l-accent px-2.5",
  list: "border-l-4 border-l-accent px-2.5",
  dictionary: "border-dashed border-l-4 border-l-muted px-2.5 [border-left-style:solid]",
  step: "border-l-2 border-l-accent/60 px-2.5",
  video: "border-l-2 border-l-accent/60 px-2.5",
  section: "border-l-2 border-l-border px-2.5",
};

const TITLE: Partial<Record<PlanMapNode["kind"], string>> = {
  root: "text-[15px] font-semibold",
  group: "text-sm font-semibold",
  block: "text-sm font-semibold",
  list: "text-sm font-semibold",
  dictionary: "text-sm font-semibold text-muted",
};

export const PlanMapBranchNode = memo(function PlanMapBranchNode({
  entry,
  solved,
  total,
  hit,
  dim,
}: {
  entry: PlanMapNode;
  solved: number;
  total: number;
  hit: boolean;
  dim: boolean;
}) {
  const { language, t } = useLanguage();
  const copy = t.planMap;
  const { index, onToggle } = useNodeContext();
  const { node, kind, expandable, expanded } = entry;
  const title = node.title[language];
  const heading =
    kind === "video"
      ? copy.section.lesson(planNodeNumber(node.id) + 1, title)
      : kind === "step"
        ? copy.section.step(planNodeNumber(node.id), title)
        : title;
  const empty = !expandable && !node.url && !node.ref;
  const countLabel = copy.map.count(solved, total);
  const showCount = total > 0 || kind === "block" || kind === "list" || kind === "dictionary";

  return (
    <div
      style={position(entry)}
      className={cn(
        NODE,
        "flex flex-col justify-center gap-0.5 transition-colors",
        SHELL[kind],
        expandable && "hover:border-accent/50",
        empty && "opacity-50",
        marks(hit, dim),
      )}
      title={empty ? (node.problems.length > 0 && node.problems.every((slug) => index.catalog.problems[slug]?.cnOnly) ? copy.section.cnOnly : copy.section.noMatch) : undefined}
    >
      {expandable && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${(expanded ? copy.map.collapse : copy.map.expand)(heading)}, ${countLabel}`}
          title={heading}
          onClick={() => onToggle(entry)}
          className="absolute inset-0 rounded-[inherit]"
        />
      )}
      <span className="pointer-events-none flex min-w-0 items-center gap-1.5">
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0",
            kind === "root" ? "text-bg/70" : "text-muted",
            expanded && "rotate-90",
            !expandable && "invisible",
          )}
        />
        <span className={cn("min-w-0 flex-1 truncate text-[13px] font-medium", TITLE[kind])}>{heading}</span>
        {showCount && (
          <span className={cn("shrink-0 text-[11px] font-normal tabular-nums", kind === "root" ? "text-bg/70" : "text-muted")}>
            {solved} / {total}
          </span>
        )}
      </span>
      {(kind === "block" || kind === "list" || kind === "dictionary") && (
        <span className="pointer-events-none">
          <ListRow node={node} />
        </span>
      )}
      {kind === "video" && (
        <span className="pointer-events-none">
          <LessonRow node={node} />
        </span>
      )}
      {kind === "step" && (
        <span className="pointer-events-none">
          <StepRow node={node} />
        </span>
      )}
      {kind === "section" && entry.h > 34 && (
        <span className="pointer-events-none">
          <SectionChips node={node} />
        </span>
      )}
    </div>
  );
});
