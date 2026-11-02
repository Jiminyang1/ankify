"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { PlanCredit } from "@/components/plan-credit";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Surface } from "@/components/ui/surface";
import { PlanListView } from "./list-view";
import { PlanMapCanvas, type PlanMapCanvasHandle } from "./map-canvas";
import { PlanMapNodeProvider, type PlanMapNodeContext } from "./map-node";
import {
  PLAN_MAP_LEVELS,
  layoutPlanMap,
  levelExpansion,
  parsePlanMapLevel,
  planMapCounts,
  searchPlanMap,
  type PlanMapLevel,
  type PlanMapNode,
  type PlanMapSearch,
} from "./plan-map-layout";
import { NO_FILTERS, PLAN_ONLY, computePlanList, parsePlanOnly, type PlanOnly, type PlanSite, type PlanStatuses } from "./plan-map-model";
import { PlanActionAlert, PlanMapFailed, PlanMapSkeleton, PlanSegments, useMapIsOffered } from "./plan-map-parts";
import { PLAN_STORAGE, readStored, replaceQuery, writeStored } from "./plan-storage";
import { usePlanMap, type PlanMapApi, type PlanMapData } from "./use-plan-map";

/** One word can match thousands of rows; open only this many. */
const SEARCH_OPEN = 60;
const SEARCH_DELAY_MS = 220;
const NO_STATUSES: PlanStatuses = {};

/** The mind map, or below `md`, where it isn't offered, the list. */
export function PlanMapTab({ currentPlan }: { currentPlan: string }) {
  const offered = useMapIsOffered();
  if (offered === null) return <PlanMapSkeleton />;
  if (!offered) return <PlanListView currentPlan={currentPlan} />;
  return <PlanMindMap currentPlan={currentPlan} />;
}

function PlanMindMap({ currentPlan }: { currentPlan: string }) {
  const map = usePlanMap();
  if (map.failed) return <PlanMapFailed onRetry={() => void map.retry()} />;
  if (!map.data) return <PlanMapSkeleton />;
  return <MapContent data={map.data} map={map} currentPlan={currentPlan} />;
}

function storedZoom(): number {
  const stored = readStored(PLAN_STORAGE.mapZoom);
  return typeof stored === "number" && Number.isFinite(stored) ? stored : 1;
}

function MapContent({ data, map, currentPlan }: { data: PlanMapData; map: PlanMapApi; currentPlan: string }) {
  const { language, t } = useLanguage();
  const copy = t.planMap;
  const { index, statuses } = data;
  const searchParams = useSearchParams();

  // These mount after the data loads, which is after hydration, so reading
  // storage while initializing state can't mismatch the server's HTML.
  const [only, setOnly] = useState<PlanOnly>(
    () => parsePlanOnly(searchParams.get("only")) ?? parsePlanOnly(readStored(PLAN_STORAGE.only)) ?? "all",
  );
  const [level, setLevel] = useState<PlanMapLevel>(() => parsePlanMapLevel(readStored(PLAN_STORAGE.mapLevel)) ?? "lists");
  const [site] = useState<PlanSite>(() => (readStored(PLAN_STORAGE.site) === "cn" ? "cn" : "com"));
  const [initialZoom] = useState(storedZoom);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => levelExpansion(index, level, only));
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<PlanMapSearch | null>(null);
  const canvas = useRef<PlanMapCanvasHandle>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  // Rows don't depend on statuses, so a tick doesn't move the map.
  const everyRow = useMemo(
    () => computePlanList({ index, filters: NO_FILTERS, statuses: NO_STATUSES, language, site }),
    [index, language, site],
  );
  const narrowRows = useMemo(
    () => computePlanList({ index, filters: NO_FILTERS, statuses: NO_STATUSES, language, site, nc150Block: true }),
    [index, language, site],
  );
  const shape = only === "nc150" ? narrowRows : everyRow;
  const counts = useMemo(() => {
    const states = computePlanList({ index, filters: NO_FILTERS, statuses, language, site, nc150Block: only === "nc150" });
    return planMapCounts(index, states, statuses, only);
  }, [index, statuses, language, site, only]);
  const layout = useMemo(() => layoutPlanMap({ index, states: shape, expanded, only }), [index, shape, expanded, only]);

  const changeOnly = useCallback((next: PlanOnly) => {
    setOnly(next);
    writeStored(PLAN_STORAGE.only, next);
    replaceQuery((params) => {
      params.set("only", next);
      params.delete("section");
    });
  }, []);

  const clearSearch = useCallback(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setQuery("");
    setSearch(null);
  }, []);

  const pickOnly = (next: PlanOnly) => {
    if (next === only) return;
    changeOnly(next);
    setExpanded(levelExpansion(index, level, next));
    clearSearch();
    canvas.current?.queue({ type: "root" });
  };

  const pickLevel = (next: PlanMapLevel) => {
    setLevel(next);
    writeStored(PLAN_STORAGE.mapLevel, next);
    setExpanded(levelExpansion(index, next, only));
    clearSearch();
    canvas.current?.queue({ type: "root" });
  };

  const runSearch = (text: string) => {
    if (!text.trim()) {
      setSearch(null);
      return;
    }
    const result = searchPlanMap({ index, states: everyRow, query: text, cap: SEARCH_OPEN });
    setSearch(result);
    if (!result.first) return;
    // A hit can be in any list, so a search looks at all of them.
    if (only !== "all") changeOnly("all");
    setExpanded((previous) => new Set([...previous, ...result.open]));
    canvas.current?.queue({ type: "node", id: result.first });
  };

  const onSearchChange = (text: string) => {
    setQuery(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runSearch(text), SEARCH_DELAY_MS);
  };

  const onToggle = useCallback((entry: PlanMapNode) => {
    canvas.current?.anchor(entry);
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(entry.id)) next.delete(entry.id);
      else next.add(entry.id);
      return next;
    });
  }, []);

  const { tick, setCurrentPlan, switching } = map;
  const nodeContext = useMemo<PlanMapNodeContext>(
    () => ({
      index,
      shape,
      site,
      only,
      currentPlan,
      switching,
      onTick: tick,
      onSetPlan: (plan) => void setCurrentPlan(plan),
      onToggle,
    }),
    [index, shape, site, only, currentPlan, switching, tick, setCurrentPlan, onToggle],
  );

  const hits = search?.hits ?? EMPTY_HITS;
  const routeUrl = index.nodes.get("X")?.url;
  const neetcodeUrl = index.nodes.get("N")?.url;

  return (
    <>
      <Surface className="flex flex-wrap items-center gap-x-5 gap-y-2.5 p-3">
        <PlanSegments
          label={copy.map.expandTo}
          value={level}
          options={PLAN_MAP_LEVELS.map((id) => ({ id, label: copy.map.levels[id] }))}
          onChange={pickLevel}
        />
        <PlanSegments
          label={copy.only.label}
          value={only}
          options={PLAN_ONLY.map((id) => ({ id, label: copy.only[id] }))}
          onChange={pickOnly}
        />
        <div className="flex min-w-[16rem] flex-1 items-center gap-3">
          <Input
            type="search"
            aria-label={copy.map.search}
            placeholder={copy.map.searchPlaceholder}
            value={query}
            onChange={(event) => onSearchChange(event.target.value)}
            className="min-h-9 min-w-0 flex-1 py-1.5"
          />
          <span aria-live="polite" className="shrink-0 text-xs tabular-nums text-muted">
            {search ? copy.map.hits(search.total, search.hits.size) : ""}
          </span>
        </div>
      </Surface>

      <PlanActionAlert error={map.actionError} />

      <Surface className="overflow-hidden">
        <PlanMapNodeProvider value={nodeContext}>
          <PlanMapCanvas
            layout={layout}
            counts={counts}
            statuses={statuses}
            hits={hits}
            initialZoom={initialZoom}
            handleRef={canvas}
          />
        </PlanMapNodeProvider>
      </Surface>

      <div className="space-y-2">
        <p className="text-[11px] leading-4 text-muted">
          {routeUrl && <PlanCredit source={{ url: routeUrl, credit: "ling" }} language={language} />}{" "}
          {neetcodeUrl && <PlanCredit source={{ url: neetcodeUrl, credit: "neetcode" }} language={language} />}
        </p>
        <MapLegend />
      </div>
    </>
  );
}

const EMPTY_HITS: ReadonlySet<string> = new Set();

function MapLegend() {
  const { t } = useLanguage();
  const tags = t.planMap.tags;
  const copy = t.planMap.map;
  const legend = copy.legend;
  const heading = "text-[11px] font-medium uppercase tracking-wide text-muted";
  const rows = [
    { pills: [tags.nc150, tags.nc250], text: legend.tags.neetcode },
    { pills: [tags.hot100, tags.top150], text: legend.tags.leetcode },
    { pills: [copy.worked, copy.homework], text: legend.tags.lesson },
    { pills: [tags.premium], text: legend.tags.premium },
    { pills: [tags.cnOnly], text: legend.tags.cnOnly },
  ];
  return (
    <details className="group text-xs leading-5 text-muted">
      <summary className="w-fit cursor-pointer rounded-md hover:text-fg">{legend.title}</summary>
      <div className="mt-2 grid gap-4 md:grid-cols-3">
        <div>
          <h3 className={heading}>{legend.ratingTitle}</h3>
          <ul className="mt-1 tabular-nums">
            <li className="text-easy">{legend.ratingBands.low}</li>
            <li className="text-medium">{legend.ratingBands.middle}</li>
            <li className="text-hard">{legend.ratingBands.high}</li>
          </ul>
          <p className="mt-1">{legend.ratingNote}</p>
        </div>
        <div>
          <h3 className={heading}>{legend.tagsTitle}</h3>
          <ul className="mt-1 space-y-1">
            {rows.map((row) => (
              <li key={row.text}>
                {row.pills.map((pill) => (
                  <Pill key={pill} compact className="mr-1">
                    {pill}
                  </Pill>
                ))}
                {row.text}
              </li>
            ))}
          </ul>
          <p className="mt-1">{legend.tagsNote}</p>
        </div>
        <div>
          <h3 className={heading}>{legend.moveTitle}</h3>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {legend.move.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}
