"use client";

import type { PlanCatalogNode } from "@ankify/core/plan-catalog";
import { ChevronRight } from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { PlanCredit } from "@/components/plan-credit";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Spinner } from "@/components/ui/spinner";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { ListFilterPanel } from "./list-filters";
import { PlanProblemRow } from "./list-row";
import {
  NEETCODE_BLOCK,
  NO_FILTERS,
  PLAN_BLOCK_TAG,
  autoOpenMatches,
  computePlanList,
  defaultOpen,
  filtersActive,
  isInScope,
  parsePlanOnly,
  pathToRoot,
  planListGroups,
  planNodeDomId,
  planNodeNumber,
  sanitizeFilters,
  visibleCount,
  type PlanFilters,
  type PlanNodeState,
  type PlanOnly,
  type PlanSite,
} from "./plan-map-model";
import { LingCredit, PlanActionAlert, PlanMapFailed, PlanMapSkeleton, ThinBar } from "./plan-map-parts";
import { PLAN_STORAGE, readStored, replaceQuery, writeStored } from "./plan-storage";
import { usePlanMap, type PlanMapApi, type PlanMapData } from "./use-plan-map";

/** Sections open by themselves while filtering until this many rows are drawn. */
const AUTO_OPEN_ROWS = 200;

type ListContextValue = {
  data: PlanMapData;
  map: PlanMapApi;
  states: ReadonlyMap<string, PlanNodeState>;
  active: boolean;
  site: PlanSite;
  flash: string | null;
  isOpen: (id: string, level: number, single: boolean) => boolean;
  toggle: (id: string, open: boolean) => void;
  jump: (id: string) => void;
};

const ListContext = createContext<ListContextValue | null>(null);

function useList() {
  const value = useContext(ListContext);
  if (!value) throw new Error("useList outside the list view");
  return value;
}

/** The list tab: every list on the map, filterable and foldable. Only open
 *  sections render their rows; there are 2,881 problems. */
export function PlanListView({ currentPlan }: { currentPlan: string }) {
  const map = usePlanMap();
  if (map.failed) return <PlanMapFailed onRetry={() => void map.retry()} />;
  if (!map.data) return <PlanMapSkeleton />;
  return <ListContent data={map.data} map={map} currentPlan={currentPlan} />;
}

function ListContent({ data, map, currentPlan }: { data: PlanMapData; map: PlanMapApi; currentPlan: string }) {
  const { language, t } = useLanguage();
  const copy = t.planMap;
  const { index, statuses } = data;
  const searchParams = useSearchParams();
  const urlOnly = parsePlanOnly(searchParams.get("only"));
  const section = searchParams.get("section");

  // These mount after the data loads, which is after hydration, so reading
  // storage while initializing state can't mismatch the server's HTML.
  const [only, setOnly] = useState<PlanOnly>(() => urlOnly ?? parsePlanOnly(readStored(PLAN_STORAGE.only)) ?? "all");
  const [filters, setFilters] = useState<PlanFilters>(() => sanitizeFilters(readStored(PLAN_STORAGE.filters) ?? NO_FILTERS));
  const [site, setSite] = useState<PlanSite>(() => (readStored(PLAN_STORAGE.site) === "cn" ? "cn" : "com"));
  const [nc150Toggle, setNc150Toggle] = useState(() => readStored(PLAN_STORAGE.nc150) === true);
  const [opened, setOpened] = useState<Record<string, boolean>>(() => {
    const stored = readStored(PLAN_STORAGE.open);
    return stored && typeof stored === "object" ? (stored as Record<string, boolean>) : {};
  });
  // What the user opened or closed under the current filters; not kept.
  const [filterOpened, setFilterOpened] = useState<Record<string, boolean>>({});
  const [flash, setFlash] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

  // A meter link changed the scope.
  const [seenUrlOnly, setSeenUrlOnly] = useState(urlOnly);
  if (urlOnly !== seenUrlOnly) {
    setSeenUrlOnly(urlOnly);
    if (urlOnly) setOnly(urlOnly);
  }

  useEffect(() => writeStored(PLAN_STORAGE.only, only), [only]);
  useEffect(() => writeStored(PLAN_STORAGE.filters, filters), [filters]);
  useEffect(() => writeStored(PLAN_STORAGE.site, site), [site]);
  useEffect(() => writeStored(PLAN_STORAGE.nc150, nc150Toggle), [nc150Toggle]);
  useEffect(() => writeStored(PLAN_STORAGE.open, opened), [opened]);

  const nc150Block = only === "nc150" || (only !== "nc250" && nc150Toggle);
  const deferredFilters = useDeferredValue(filters);
  const active = filtersActive(deferredFilters);
  const states = useMemo(
    () => computePlanList({ index, filters: deferredFilters, statuses, language, site, nc150Block }),
    [index, deferredFilters, statuses, language, site, nc150Block],
  );
  const groups = useMemo(() => planListGroups(index, only), [index, only]);
  const auto = useMemo(() => autoOpenMatches(groups.flatMap((group) => group.blocks), states, AUTO_OPEN_ROWS), [groups, states]);

  const updateFilters = useCallback((next: PlanFilters) => {
    setFilters(next);
    setFilterOpened({});
  }, []);

  const changeOnly = useCallback((next: PlanOnly) => {
    setOnly(next);
    replaceQuery((params) => {
      params.set("only", next);
      params.delete("section");
    });
  }, []);

  const isOpen = useCallback(
    (id: string, level: number, single: boolean) =>
      active ? (filterOpened[id] ?? auto.open.has(id)) : (opened[id] ?? defaultOpen(level, single)),
    [active, auto, filterOpened, opened],
  );

  const toggle = useCallback(
    (id: string, open: boolean) => (active ? setFilterOpened : setOpened)((previous) => ({ ...previous, [id]: open })),
    [active],
  );

  const jump = useCallback(
    (id: string) => {
      const path = Object.fromEntries(pathToRoot(index, id).map((ancestor) => [ancestor, true]));
      setOpened((previous) => ({ ...previous, ...path }));
      setFilterOpened((previous) => ({ ...previous, ...path }));
      setOnly((previous) => (isInScope(index, id, previous) ? previous : "all"));
      setScrollTarget(id);
    },
    [index],
  );

  // A jump from the route view, or a shared link.
  const handledSection = useRef<string | null>(null);
  useEffect(() => {
    if (!section || handledSection.current === section || !index.nodes.has(section)) return;
    handledSection.current = section;
    jump(section);
  }, [section, index, jump]);

  useEffect(() => {
    if (!scrollTarget) return;
    const element = document.getElementById(planNodeDomId(scrollTarget));
    if (!element) return;
    element.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the element only exists once rendered
    setFlash(scrollTarget);
    setScrollTarget(null);
    // The target can appear only once what opens it has rendered.
  }, [scrollTarget, opened, filterOpened, only, states]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(timer);
  }, [flash]);

  const countLine = useMemo(() => {
    if (active) return copy.count.matched(auto.unique, auto.rows);
    if (only === "all" || only === "dictionary") {
      const lists = index.nodes.get("G")!.children.filter((node) => node.id.startsWith("L")).map((node) => node.id);
      const dictionary = visibleCount(index, lists, language, site);
      if (only === "dictionary") return copy.count.scoped(copy.only.dictionary, dictionary);
      return copy.count.everything(visibleCount(index, ["C", "X", "N", "H", "T"], language, site), dictionary);
    }
    return copy.count.scoped(copy.only[only], states.get(groups[0]!.blocks[0]!.id)?.all.size ?? 0);
  }, [active, auto, copy, groups, index, language, only, site, states]);

  const value = useMemo<ListContextValue>(
    () => ({ data, map, states, active, site, flash, isOpen, toggle, jump }),
    [data, map, states, active, site, flash, isOpen, toggle, jump],
  );

  const routeUrl = index.nodes.get("X")?.url ?? "";

  return (
    <ListContext.Provider value={value}>
      <ListFilterPanel
        filters={filters}
        onFilters={updateFilters}
        only={only}
        onOnly={changeOnly}
        site={site}
        onSite={setSite}
        countLine={countLine}
        cutLine={active && auto.rows > auto.rendered ? copy.count.cut(auto.rendered, auto.rows - auto.rendered) : null}
      />

      <PlanActionAlert error={map.actionError} />

      {groups.map((group) => (
        <section key={group.key} className="space-y-2">
          <div>
            <h2 className="text-base font-semibold">{copy.categories[group.key]}</h2>
            {group.key !== "frequent" && <LingCredit url={routeUrl} />}
          </div>
          {group.blocks.map((block) => (
            <PlanBlock
              key={block.id}
              block={block}
              single={group.single}
              currentPlan={currentPlan}
              nc150={block.id === NEETCODE_BLOCK && nc150Block}
              onNc150={() => {
                if (only === "nc150") changeOnly("nc250");
                else if (only === "nc250") changeOnly("nc150");
                else setNc150Toggle(!nc150Toggle);
              }}
            />
          ))}
        </section>
      ))}
    </ListContext.Provider>
  );
}

function descendants(node: PlanCatalogNode): string[] {
  return node.children.flatMap((child) => [child.id, ...descendants(child)]);
}

function NoMatchNote({ node, state }: { node: PlanCatalogNode; state: PlanNodeState | undefined }) {
  const { t } = useLanguage();
  const { problems } = useList().data.index.catalog;
  // English readers don't get leetcode.cn-only problems, and a chapter of only
  // those would otherwise look broken.
  const onlyCn = !state?.all.size && node.problems.length > 0 && node.problems.every((slug) => problems[slug]?.cnOnly);
  return <span className="text-xs text-muted">{onlyCn ? t.planMap.section.cnOnly : t.planMap.section.noMatch}</span>;
}

function PlanBlock({
  block,
  single,
  currentPlan,
  nc150,
  onNc150,
}: {
  block: PlanCatalogNode;
  single: boolean;
  currentPlan: string;
  nc150: boolean;
  onNc150: () => void;
}) {
  const { language, t } = useLanguage();
  const copy = t.planMap;
  const { states, active, flash, isOpen, toggle, map } = useList();
  const state = states.get(block.id);
  const open = isOpen(block.id, 0, single);
  const empty = active && (state?.matched.size ?? 0) === 0;
  const plan = (nc150 ? block.tagPlans?.nc150 : undefined) ?? block.plan;
  const solved = state?.solved ?? 0;
  const total = state?.all.size ?? 0;
  const blurb = copy.blurbs[block.id as keyof typeof copy.blurbs];

  return (
    <Surface
      id={planNodeDomId(block.id)}
      className={cn("scroll-mt-28", flash === block.id && "ring-2 ring-accent/40", empty && "opacity-50")}
    >
      <div className="grid gap-x-4 gap-y-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-4">
        <button
          type="button"
          aria-expanded={!empty && open}
          disabled={empty}
          onClick={() => toggle(block.id, !open)}
          className="min-w-0 rounded-md text-left disabled:cursor-default"
        >
          <span className="flex items-baseline gap-2">
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0 translate-y-0.5 text-muted transition-transform motion-reduce:transition-none",
                open && !empty && "rotate-90",
                empty && "invisible",
              )}
            />
            <span className="min-w-0">
              <span className="text-base font-semibold">{block.title[language]}</span>{" "}
              <span className="whitespace-nowrap text-xs tabular-nums text-muted">
                {solved} / {total}
              </span>
            </span>
          </span>
          <span className="mt-0.5 block pl-6 text-xs leading-5 text-muted">{empty ? copy.section.noMatch : blurb}</span>
        </button>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-6 text-xs text-muted sm:justify-end sm:pl-0">
          {block.url && block.id !== NEETCODE_BLOCK && (
            <a href={block.url} target="_blank" rel="noreferrer" className="underline hover:text-fg">
              {copy.block.source}
            </a>
          )}
          {block.id === NEETCODE_BLOCK && block.url && (
            <PlanCredit source={{ url: block.url, credit: "neetcode" }} language={language} />
          )}
          {block.updated && <span className="tabular-nums">{copy.block.updated(block.updated)}</span>}
          {plan &&
            (plan === currentPlan ? (
              <Pill tone="accent">{copy.block.current}</Pill>
            ) : (
              <Button
                variant="secondary"
                size="xs"
                disabled={map.switching != null}
                onClick={() => void map.setCurrentPlan(plan)}
              >
                {map.switching === plan && <Spinner />}
                {copy.block.setCurrent}
              </Button>
            ))}
        </div>
        <ThinBar solved={solved} total={total} className="sm:col-span-2" />
      </div>

      {open && !empty && (
        <div className="border-t border-border px-3 pb-3 pt-2 sm:px-4">
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 pb-1">
            {block.id === NEETCODE_BLOCK && (
              <label className="mr-auto inline-flex min-h-7 cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={nc150}
                  onChange={onNc150}
                  className="size-4 cursor-pointer accent-[rgb(var(--accent))]"
                />
                {copy.block.nc150Toggle}
              </label>
            )}
            <Button variant="ghost" size="xs" onClick={() => setAll(block, true)}>
              {copy.block.expandAll}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setAll(block, false)}>
              {copy.block.collapseAll}
            </Button>
          </div>
          <SectionChildren node={block} level={1} blockId={block.id} />
        </div>
      )}
    </Surface>
  );

  function setAll(node: PlanCatalogNode, value: boolean) {
    for (const id of descendants(node)) toggle(id, value);
  }
}

/** A node's sections, with a note for the ones a filter emptied. */
function SectionChildren({ node, level, blockId }: { node: PlanCatalogNode; level: number; blockId: string }) {
  const { t } = useLanguage();
  const { states, active } = useList();
  const hidden =
    active && level > 1 ? node.children.filter((child) => (states.get(child.id)?.matched.size ?? 0) === 0).length : 0;
  return (
    <>
      {node.children.map((child) => (
        <SectionNode key={child.id} node={child} level={level} blockId={blockId} />
      ))}
      {hidden > 0 && <p className="mt-1.5 pl-6 text-xs text-muted">{t.planMap.section.hiddenSubs(hidden)}</p>}
    </>
  );
}

function SectionNode({ node, level, blockId }: { node: PlanCatalogNode; level: number; blockId: string }) {
  const { language, t } = useLanguage();
  const copy = t.planMap.section;
  const { states, active, flash, isOpen, toggle } = useList();
  const state = states.get(node.id);
  const matched = state?.matched.size ?? 0;
  const total = state?.all.size ?? 0;
  const title = node.title[language];
  const heading =
    node.kind === "video"
      ? copy.lesson(planNodeNumber(node.id) + 1, title)
      : node.kind === "step"
        ? copy.step(planNodeNumber(node.id), title)
        : title;
  const rowClass = cn(
    "scroll-mt-28 rounded-md transition-colors motion-reduce:transition-none",
    flash === node.id && "bg-accent-soft",
  );

  // Step 0 is a link to LeetCode's primer, with no problems of its own.
  if (node.kind === "step" && node.url && node.children.length === 0) {
    return (
      <div id={planNodeDomId(node.id)} className={cn(rowClass, "flex flex-wrap items-center gap-2 py-1.5 pl-6 text-sm")}>
        <span className="font-medium">{heading}</span>
        <a href={node.url} target="_blank" rel="noreferrer" className="text-xs text-accent underline">
          {copy.openPrimer}
        </a>
      </div>
    );
  }

  const pointerOnly = total === 0 && node.ref != null;
  // Filters never remove a chapter: it stays, greyed out. Inside a chapter,
  // the note under the rows says how many sections had nothing.
  if (active && matched === 0 && level > 1) return null;
  if (!pointerOnly && (matched === 0 || total === 0)) {
    return (
      <div
        id={planNodeDomId(node.id)}
        className={cn(rowClass, "flex flex-wrap items-baseline gap-x-2 py-1.5 pl-6 text-sm opacity-50")}
      >
        <span className="font-medium">{heading}</span>
        <NoMatchNote node={node} state={state} />
        <span className="ml-auto text-xs tabular-nums text-muted">
          {state?.solved ?? 0} / {total}
        </span>
      </div>
    );
  }

  const expandable = !pointerOnly;
  const open = expandable && isOpen(node.id, level, false);

  return (
    <div id={planNodeDomId(node.id)} className={cn(rowClass, "mt-1", level > 1 && "border-l-2 border-border/60 pl-2 sm:pl-3")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1">
        <button
          type="button"
          aria-expanded={expandable ? open : undefined}
          disabled={!expandable}
          onClick={() => toggle(node.id, !open)}
          className="flex min-w-0 items-baseline gap-2 rounded-md text-left text-sm font-medium hover:text-accent disabled:hover:text-fg"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 translate-y-0.5 text-muted transition-transform motion-reduce:transition-none",
              open && "rotate-90",
              !expandable && "invisible",
            )}
          />
          <span className="min-w-0">{heading}</span>
        </button>
        <SectionChips node={node} matched={matched} />
        {total > 0 && (
          <span className="ml-auto text-xs tabular-nums text-muted">
            {state?.solved ?? 0} / {total}
          </span>
        )}
      </div>
      {open && <SectionBody node={node} level={level} blockId={blockId} state={state} />}
    </div>
  );
}

function SectionChips({ node, matched }: { node: PlanCatalogNode; matched: number }) {
  const { language, t } = useLanguage();
  const copy = t.planMap.section;
  const { data, active, jump } = useList();
  const { index } = data;
  const inCoreCut = node.kind === "step" || node.source != null;
  const parent = index.nodes.get(index.parents.get(node.id) ?? "");
  const sourceSize = node.source ? (index.subtree.get(node.source)?.length ?? 0) : 0;
  const refTarget = node.ref ? index.nodes.get(node.ref) : undefined;
  const via = node.via ? index.nodes.get(node.via) : undefined;
  const deepDive = node.deepDive ? index.planNode.get(node.deepDive) : undefined;
  const chip = "inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] leading-none text-muted transition-colors hover:border-accent/40 hover:text-fg";

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {inCoreCut && node.stepCap && <Pill>{copy.capChip(node.stepCap)}</Pill>}
      {node.optional && !parent?.optional && <Pill>{copy.optional}</Pill>}
      {via && <Pill>{copy.via(via.title[language])}</Pill>}
      {refTarget && (
        <button type="button" className={chip} onClick={() => jump(refTarget.id)}>
          {copy.see(refTarget.title[language])}
        </button>
      )}
      {node.source && node.children.length === 0 && sourceSize > node.problems.length && (
        <button type="button" className={chip} onClick={() => jump(node.source!)}>
          {copy.inFullList(sourceSize)}
        </button>
      )}
      {deepDive && (
        <button type="button" className={chip} onClick={() => jump(deepDive.id)}>
          {copy.fullList}
        </button>
      )}
      {(node.videos ?? []).map((videoId) => {
        const video = index.nodes.get(videoId);
        return video?.videoUrl ? (
          <a key={videoId} href={video.videoUrl} target="_blank" rel="noreferrer" className={chip}>
            {copy.videoChip(video.title[language])}
          </a>
        ) : null;
      })}
      {active && matched > 0 && <Pill tone="accent">{copy.matched(matched)}</Pill>}
    </span>
  );
}

function SectionBody({
  node,
  level,
  blockId,
  state,
}: {
  node: PlanCatalogNode;
  level: number;
  blockId: string;
  state: PlanNodeState | undefined;
}) {
  const { t } = useLanguage();
  const copy = t.planMap.section;
  const rows = state?.rows ?? [];
  const homework = state?.homework ?? [];
  return (
    <div className="pl-1 sm:pl-6">
      {node.kind === "video" && node.videoUrl && (
        <a href={node.videoUrl} target="_blank" rel="noreferrer" className="mb-1 inline-block text-xs text-accent underline">
          {copy.watch}
        </a>
      )}
      {node.kind === "video" && rows.length > 0 && <RowHeading>{copy.worked}</RowHeading>}
      <Rows slugs={rows} blockId={blockId} />
      {homework.length > 0 && <RowHeading>{copy.homework}</RowHeading>}
      <Rows slugs={homework} blockId={blockId} />
      <SectionChildren node={node} level={level + 1} blockId={blockId} />
    </div>
  );
}

function RowHeading({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">{children}</p>;
}

function Rows({ slugs, blockId }: { slugs: readonly string[]; blockId: string }) {
  const { data, map, site } = useList();
  if (slugs.length === 0) return null;
  const { index, statuses } = data;
  return (
    <ul>
      {slugs.map((slug) => {
        const problem = index.catalog.problems[slug];
        if (!problem) return null;
        return (
          <PlanProblemRow
            key={slug}
            problem={problem}
            entry={statuses[slug]}
            site={site}
            hideTag={PLAN_BLOCK_TAG[blockId]}
            videoUrl={blockId === "C" ? undefined : index.videoOf.get(slug)?.videoUrl}
            adding={map.adding === slug}
            onTick={map.tick}
            onAdd={map.addToReview}
          />
        );
      })}
    </ul>
  );
}
