import type { PlanMetersDto } from "@ankify/contracts";
import { PLAN_ROUTE_SOURCE_URL, NEETCODE_SOURCE_URL } from "@ankify/core/plan-catalog";
import type { Route } from "next";
import Link from "next/link";
import { PlanCredit } from "@/components/plan-credit";
import { Surface } from "@/components/ui/surface";
import { getTranslations, type Language } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { PlanOnly } from "./plan-map-model";

const METERS: readonly { key: keyof PlanMetersDto["lists"]; only: PlanOnly }[] = [
  { key: "course", only: "course" },
  { key: "route", only: "core" },
  { key: "nc150", only: "nc150" },
  { key: "nc250", only: "nc250" },
  { key: "hot100", only: "hot100" },
  { key: "top150", only: "top150" },
];

const CELL = "flex min-w-0 flex-col justify-between gap-1.5 rounded-lg px-3 py-2.5 transition-colors";
const LINK_CELL = `${CELL} hover:bg-subtle`;

function listHref(only: PlanOnly): Route {
  return `/profile?view=list&only=${only}` as Route;
}

function Bar({ solved, total }: { solved: number; total: number }) {
  return (
    <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-border/70">
      <div className="h-full rounded-full bg-accent" style={{ width: `${total > 0 ? (solved / total) * 100 : 0}%` }} />
    </div>
  );
}

/** Solved of total on every list, on every tab of the Plan page. Clicking a
 *  list opens the list view scoped to it. */
export function PlanMeters({ meters, language }: { meters: PlanMetersDto; language: Language }) {
  const copy = getTranslations(language).planMap;
  const names = copy.meters;
  return (
    <Surface as="section" aria-label={names.label} className="p-2">
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-[minmax(0,1.7fr)_repeat(7,minmax(0,1fr))]">
        <Link
          href={listHref("all")}
          scroll={false}
          aria-label={names.open(names.main, meters.main.solved, meters.main.total)}
          className={cn(LINK_CELL, "col-span-2 sm:col-span-4 lg:col-span-1")}
        >
          <span className="text-xs leading-4 text-muted">
            {names.main}
            <span className="block text-[11px]">{names.mainNote}</span>
          </span>
          <span className="text-2xl font-semibold tabular-nums leading-none">
            {meters.main.solved}
            <span className="text-sm font-normal text-muted"> / {meters.main.total}</span>
          </span>
          <Bar solved={meters.main.solved} total={meters.main.total} />
        </Link>
        {METERS.map(({ key, only }) => {
          const meter = meters.lists[key];
          return (
            <Link
              key={key}
              href={listHref(only)}
              scroll={false}
              aria-label={names.open(names[key], meter.solved, meter.total)}
              className={LINK_CELL}
            >
              <span className="truncate text-xs text-muted">{names[key]}</span>
              <span className="text-sm font-semibold tabular-nums">
                {meter.solved}
                <span className="font-normal text-muted"> / {meter.total}</span>
              </span>
              <Bar solved={meter.solved} total={meter.total} />
            </Link>
          );
        })}
        {meters.due > 0 ? (
          <Link href="/review" className={LINK_CELL}>
            <span className="truncate text-xs text-muted">{names.due}</span>
            <span className="text-sm font-semibold tabular-nums text-warning">{meters.due}</span>
            <span className="truncate text-[11px] text-muted">{names.dueNote}</span>
          </Link>
        ) : (
          <div className={CELL}>
            <span className="truncate text-xs text-muted">{names.due}</span>
            <span className="text-sm font-semibold tabular-nums">0</span>
            <span className="truncate text-[11px] text-muted">{names.dueNone}</span>
          </div>
        )}
      </div>
      <p className="px-3 pb-1 pt-2 text-[11px] leading-4 text-muted">
        <PlanCredit source={{ url: PLAN_ROUTE_SOURCE_URL, credit: "ling" }} language={language} />{" "}
        <PlanCredit source={{ url: NEETCODE_SOURCE_URL, credit: "neetcode" }} language={language} />
      </p>
    </Surface>
  );
}
