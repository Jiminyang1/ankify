"use client";

import type { PlanCatalogNode } from "@ankify/core/plan-catalog";
import { ChevronRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useMemo } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { PlanCredit } from "@/components/plan-credit";
import { buttonClasses } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { NO_FILTERS, computePlanList, isVisibleProblem, type PlanNodeState } from "./plan-map-model";
import { LingCredit, PlanMapFailed, PlanMapSkeleton, ThinBar } from "./plan-map-parts";
import { usePlanMap, type PlanMapData } from "./use-plan-map";

/** The route tab: how the lists fit together, in order. Every chapter links
 *  into the list view. */
export function PlanRouteView() {
  const map = usePlanMap();
  if (map.failed) return <PlanMapFailed onRetry={() => void map.retry()} />;
  if (!map.data) return <PlanMapSkeleton />;
  return <RouteContent data={map.data} />;
}

function sectionHref(id: string): Route {
  return `/profile?view=list&section=${encodeURIComponent(id)}` as Route;
}

function JumpLink({ id, children, main }: { id: string; children: React.ReactNode; main?: boolean }) {
  return (
    <Link
      href={sectionHref(id)}
      className={buttonClasses({
        variant: "secondary",
        size: "xs",
        className: cn("h-auto min-h-7 max-w-full whitespace-normal py-1 text-left", main && "border-accent/40 text-accent"),
      })}
    >
      {children}
    </Link>
  );
}

function Source({ url, label }: { url: string; label: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="whitespace-nowrap text-xs text-accent underline">
      {label}
    </a>
  );
}

function SectionHeading({ title, intro }: { title: string; intro: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{intro}</p>
    </div>
  );
}

const TH = "whitespace-nowrap px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted";
const TH_NUM = `${TH} text-right`;
const TD = "border-t border-border px-3 py-2 align-top";
const TD_NUM = `${TD} whitespace-nowrap text-right tabular-nums`;

function TableFrame({ children }: { children: React.ReactNode }) {
  return (
    <Surface className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-sm">{children}</table>
    </Surface>
  );
}

function RouteContent({ data }: { data: PlanMapData }) {
  const { language, t } = useLanguage();
  const copy = t.planMap.route;
  const { index, statuses } = data;
  const states = useMemo(
    () => computePlanList({ index, filters: NO_FILTERS, statuses, language, site: "com" }),
    [index, statuses, language],
  );
  const nc150 = useMemo(() => {
    const slugs = (index.subtree.get("N") ?? []).filter((slug) => {
      const problem = index.catalog.problems[slug];
      return problem?.tags.includes("nc150") && isVisibleProblem(problem, language, "com");
    });
    return { total: slugs.length, solved: slugs.filter((slug) => statuses[slug]).length };
  }, [index, statuses, language]);

  const node = (id: string) => index.nodes.get(id)!;
  const count = (id: string) => progress(states.get(id));
  const lingUrl = node("X").url ?? "";
  const dictionary = node("G").children;
  const lists = dictionary.filter((list) => list.id.startsWith("L"));
  const dictionaryTotal = new Set(lists.flatMap((list) => [...(states.get(list.id)?.all ?? [])])).size;
  const courseUrl = node("C").url ?? "";

  const frequentRows: { key: keyof typeof copy.frequentRows; id: string; title: string; total: number; solved: number }[] = [
    { key: "nc150", id: "N", title: "NeetCode 150", ...nc150 },
    { key: "nc250", id: "N", title: "NeetCode 250", ...count("N") },
    { key: "hot100", id: "H", title: node("H").title[language], ...count("H") },
    { key: "top150", id: "T", title: node("T").title[language], ...count("T") },
    { key: "lc75", id: "O:leetcode-75", title: node("O:leetcode-75").title[language], ...count("O:leetcode-75") },
  ];

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionHeading
          title={copy.courseTitle}
          intro={
            <>
              {copy.courseIntro}
              {language === "en" && <> {copy.videosInChinese}</>}
            </>
          }
        />
        <LingCredit url={courseUrl} />
        <TableFrame>
          <thead>
            <tr>
              <th className={TH_NUM}>{copy.columns.number}</th>
              <th className={TH}>{copy.columns.video}</th>
              <th className={TH}>{copy.columns.sections}</th>
              <th className={TH_NUM}>{copy.columns.examples}</th>
              <th className={TH_NUM}>{copy.columns.homework}</th>
              <th className={TH_NUM}>{copy.columns.solved}</th>
            </tr>
          </thead>
          <tbody>
            {node("C").children.map((video, position) => {
              const done = count(video.id);
              return (
                <tr key={video.id}>
                  <td className={TD_NUM}>{position + 1}</td>
                  <td className={TD}>
                    <a href={video.videoUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                      {video.title[language]}
                    </a>
                  </td>
                  <td className={TD}>
                    <div className="flex flex-wrap gap-1">
                      {(video.links ?? []).map((id) => (
                        <JumpLink key={id} id={id}>
                          {index.nodes.get(id)?.title[language] ?? id}
                        </JumpLink>
                      ))}
                    </div>
                  </td>
                  <td className={TD_NUM}>{video.problems.length}</td>
                  <td className={TD_NUM}>{video.homework?.length ?? 0}</td>
                  <td className={TD_NUM}>
                    {done.solved} / {done.total}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableFrame>
      </section>

      <section className="space-y-3">
        <SectionHeading title={copy.coreTitle} intro={copy.coreIntro} />
        <LingCredit url={lingUrl} />
        <RouteTracks />
        <p className="max-w-3xl text-sm leading-6 text-muted">{copy.coreAfter}</p>
        <ol className="space-y-2">
          {node("X").children.map((step, position) => (
            <RouteStep key={step.id} step={step} number={position} state={states.get(step.id)} data={data} />
          ))}
        </ol>
      </section>

      <section className="space-y-3">
        <SectionHeading title={copy.frequentTitle} intro={copy.frequentIntro} />
        <TableFrame>
          <thead>
            <tr>
              <th className={TH}>{copy.columns.list}</th>
              <th className={TH}>{copy.columns.about}</th>
              <th className={TH_NUM}>{copy.columns.problems}</th>
              <th className={TH_NUM}>{copy.columns.solved}</th>
            </tr>
          </thead>
          <tbody>
            {frequentRows.map((row) => (
              <tr key={row.key}>
                <td className={TD}>
                  <div className="flex flex-wrap items-center gap-2">
                    <JumpLink id={row.id}>{row.title}</JumpLink>
                    {node(row.id).url && <Source url={node(row.id).url!} label={t.planMap.block.source} />}
                  </div>
                </td>
                <td className={cn(TD, "text-muted")}>{copy.frequentRows[row.key]}</td>
                <td className={TD_NUM}>{row.total}</td>
                <td className={TD_NUM}>
                  {row.solved} / {row.total}
                </td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
        <p className="text-xs leading-5 text-muted">
          <PlanCredit source={{ url: node("N").url ?? "", credit: "neetcode" }} language={language} />
        </p>
      </section>

      <section className="space-y-3">
        <SectionHeading title={copy.dictionaryTitle} intro={copy.dictionaryIntro(lists.length, dictionaryTotal)} />
        <LingCredit url={lingUrl} />
        <TableFrame>
          <thead>
            <tr>
              <th className={TH_NUM}>{copy.columns.number}</th>
              <th className={TH}>{copy.columns.list}</th>
              <th className={TH}>{copy.columns.about}</th>
              <th className={TH_NUM}>{copy.columns.problems}</th>
              <th className={TH}>{copy.columns.updated}</th>
              <th className={TH_NUM}>{copy.columns.solved}</th>
            </tr>
          </thead>
          <tbody>
            {dictionary.map((list, position) => {
              const done = count(list.id);
              return (
                <tr key={list.id}>
                  <td className={TD_NUM}>{position + 1}</td>
                  <td className={TD}>
                    <div className="flex flex-wrap items-center gap-2">
                      <JumpLink id={list.id}>{list.title[language]}</JumpLink>
                      {list.url && <Source url={list.url} label={t.planMap.block.source} />}
                    </div>
                  </td>
                  <td className={cn(TD, "text-muted")}>{t.planMap.blurbs[list.id as keyof typeof t.planMap.blurbs]}</td>
                  <td className={TD_NUM}>{done.total}</td>
                  <td className={cn(TD, "whitespace-nowrap tabular-nums text-muted")}>{list.updated ?? ""}</td>
                  <td className={TD_NUM}>
                    {done.solved} / {done.total}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableFrame>
      </section>
    </div>
  );
}

function progress(state: PlanNodeState | undefined) {
  return { solved: state?.solved ?? 0, total: state?.all.size ?? 0 };
}

/** The two tracks of the route, as a picture rather than a sentence. */
function RouteTracks() {
  const { t } = useLanguage();
  const copy = t.planMap.route;
  const names = copy.tracks;
  const rows: { label: string; pills: string[] }[] = [
    { label: names.basics, pills: [names.slidingFirst, names.binarySearch] },
    { label: "", pills: [names.sliding, names.enumeration, names.prefix, names.structures] },
    { label: names.recursion, pills: [names.tree, names.gridBacktrack, names.dp] },
  ];
  return (
    <Surface className="space-y-2 p-3 sm:p-4" role="group" aria-label={copy.trackLabel}>
      {rows.map((row, position) => (
        <div key={position} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="w-full text-xs text-muted empty:hidden sm:w-20 sm:empty:block">{row.label}</span>
          {row.pills.map((pill, index) => (
            <span key={pill} className="inline-flex items-center gap-2">
              {index > 0 && <ChevronRight aria-hidden="true" className="size-3.5 text-muted" />}
              <span className="rounded-md border border-border bg-subtle px-2 py-1 text-xs">{pill}</span>
            </span>
          ))}
        </div>
      ))}
    </Surface>
  );
}

function RouteStep({
  step,
  number,
  state,
  data,
}: {
  step: PlanCatalogNode;
  number: number;
  state: PlanNodeState | undefined;
  data: PlanMapData;
}) {
  const { language, t } = useLanguage();
  const copy = t.planMap.route;
  const { solved, total } = progress(state);
  const deepDive = step.deepDive ? data.index.planNode.get(step.deepDive) : undefined;
  return (
    <li>
      <Surface className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-2 p-3 sm:grid-cols-[2.25rem_minmax(0,1fr)_9rem] sm:p-4">
        <span aria-hidden="true" className="text-2xl font-semibold leading-none tabular-nums text-accent">
          {number}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            {step.title[language]}{" "}
            <span className="font-normal text-xs text-muted">
              {step.stepCap && deepDive
                ? copy.stepMeta(deepDive.title[language], step.stepCap)
                : copy.stepZero}
            </span>
          </h3>
          <p className="mt-0.5 text-sm leading-6 text-muted">{copy.steps[number]}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {step.url && step.children.length === 0 ? (
              <a
                href={step.url}
                target="_blank"
                rel="noreferrer"
                className={buttonClasses({ variant: "secondary", size: "xs" })}
              >
                {copy.openPrimer}
              </a>
            ) : (
              <>
                <JumpLink id={step.id} main>
                  {copy.openStep(total)}
                </JumpLink>
                {step.children.map((section) => (
                  <JumpLink key={section.id} id={section.id}>
                    {section.title[language]}
                  </JumpLink>
                ))}
              </>
            )}
          </div>
        </div>
        {total > 0 && (
          <div className="col-start-2 sm:col-start-3 sm:row-start-1">
            <p className="text-xs tabular-nums text-muted sm:text-right">
              {solved} / {total}
            </p>
            <ThinBar solved={solved} total={total} className="mt-1" />
          </div>
        )}
      </Surface>
    </li>
  );
}
