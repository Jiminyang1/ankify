"use client";

import type { PlanStatusesDto } from "@ankify/contracts";
import type { PlanCatalog } from "@ankify/core/plan-catalog";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { applyTick, buildPlanIndex, type PlanIndex, type PlanStatuses } from "./plan-map-model";

/**
 * The data behind the Plan page's map tabs. The catalog is the same for
 * everyone, so it's kept for the session; statuses load each time a tab opens.
 * Ticks show at once and roll back if the server refuses. Anything that changes
 * a status refreshes the page's server-rendered meters.
 */

let catalogIndex: PlanIndex | null = null;
let catalogLoad: Promise<PlanIndex> | null = null;

function loadCatalog(): Promise<PlanIndex> {
  if (catalogIndex) return Promise.resolve(catalogIndex);
  catalogLoad ??= fetch("/api/study-plan/catalog")
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      catalogIndex = buildPlanIndex((await response.json()) as PlanCatalog);
      return catalogIndex;
    })
    .finally(() => {
      catalogLoad = null;
    });
  return catalogLoad;
}

async function loadStatuses(): Promise<PlanStatusesDto> {
  const response = await fetch("/api/study-plan/statuses");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as PlanStatusesDto;
}

export type PlanActionError = "tick" | "add" | "plan" | null;

export function usePlanMap() {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [index, setIndex] = useState<PlanIndex | null>(catalogIndex);
  const [statuses, setStatuses] = useState<PlanStatuses | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [actionError, setActionError] = useState<PlanActionError>(null);
  // Ticks read the latest statuses, not the ones they were created with, so
  // the row callback stays stable and rows can stay memoized.
  const latest = useRef<PlanStatuses | null>(null);
  const addingRef = useRef(false);

  const put = useCallback((next: PlanStatuses) => {
    latest.current = next;
    setStatuses(next);
  }, []);

  const refreshServer = useCallback(() => {
    startRefresh(() => router.refresh());
  }, [router]);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [loadedIndex, loaded] = await Promise.all([loadCatalog(), loadStatuses()]);
      setIndex(loadedIndex);
      put(loaded.statuses);
    } catch {
      setFailed(true);
    }
  }, [put]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching on mount
    void load();
  }, [load]);

  const tick = useCallback(
    async (slug: string, done: boolean) => {
      if (!latest.current) return;
      setActionError(null);
      put(applyTick(latest.current, slug, done));
      try {
        const response = await fetch("/api/study-plan/tick", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug, done }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        refreshServer();
      } catch {
        // Undo only this tick: others may have landed while it was in flight.
        if (latest.current) put(applyTick(latest.current, slug, !done));
        setActionError("tick");
      }
    },
    [put, refreshServer],
  );

  const addToReview = useCallback(
    async (slug: string) => {
      if (addingRef.current) return;
      addingRef.current = true;
      setAdding(slug);
      setActionError(null);
      try {
        const response = await fetch("/api/profile/add-to-review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slugs: [slug] }),
        });
        const body = (await response.json().catch(() => null)) as { failed?: string[] } | null;
        if (!response.ok || (body?.failed?.length ?? 0) > 0) setActionError("add");
        else put((await loadStatuses()).statuses);
        refreshServer();
      } catch {
        setActionError("add");
      } finally {
        addingRef.current = false;
        setAdding(null);
      }
    },
    [put, refreshServer],
  );

  const setCurrentPlan = useCallback(
    async (plan: string) => {
      setSwitching(plan);
      setActionError(null);
      try {
        const response = await fetch("/api/study-plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ plan }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        refreshServer();
      } catch {
        setActionError("plan");
      } finally {
        setSwitching(null);
      }
    },
    [refreshServer],
  );

  return {
    data: index && statuses ? { index, statuses } : null,
    failed,
    retry: load,
    tick,
    addToReview,
    setCurrentPlan,
    adding,
    switching,
    actionError,
  };
}

export type PlanMapApi = ReturnType<typeof usePlanMap>;
export type PlanMapData = NonNullable<PlanMapApi["data"]>;
