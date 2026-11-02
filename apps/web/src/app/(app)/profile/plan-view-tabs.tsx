"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { Tabs } from "@/components/ui/tabs";
import { PLAN_VIEWS, type PlanView } from "./plan-map-model";

/** The Plan page's views, in the URL so they survive a reload and can be linked. */
export function PlanViewTabs({ view }: { view: PlanView }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(view);

  return (
    <Tabs
      className="w-fit max-w-full rounded-lg bg-subtle p-1"
      active={shown}
      tabs={PLAN_VIEWS.map((id) => ({ id, label: t.planMap.views[id] }))}
      onChange={(id) => {
        startTransition(() => {
          setShown(id as PlanView);
          router.push((id === "plan" ? "/profile" : `/profile?view=${id}`) as Route, { scroll: false });
        });
      }}
    />
  );
}
