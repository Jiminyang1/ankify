"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { Tabs } from "@/components/ui/tabs";
import { PLAN_VIEWS, type PlanView } from "./plan-map-model";
import { useMapIsOffered } from "./plan-map-parts";

/** The Plan page's views, in the URL so they survive a reload and can be linked. */
export function PlanViewTabs({ view }: { view: PlanView }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [optimistic, setShown] = useOptimistic(view);
  // On a phone the map's link shows the list, so the List tab is the active one.
  const offered = useMapIsOffered();
  const shown = optimistic === "map" && offered === false ? "list" : optimistic;

  return (
    <Tabs
      className="w-fit max-w-full rounded-lg bg-subtle p-1"
      active={shown}
      tabs={PLAN_VIEWS.map((id) => ({
        id,
        label: t.planMap.views[id],
        // CSS, not script: a phone never sees it, even before hydration.
        className: id === "map" ? "hidden md:block" : undefined,
      }))}
      onChange={(id) => {
        startTransition(() => {
          setShown(id as PlanView);
          router.push((id === "plan" ? "/profile" : `/profile?view=${id}`) as Route, { scroll: false });
        });
      }}
    />
  );
}
