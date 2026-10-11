"use client";

import { useCallback, useEffect, useState } from "react";
import type { WeaknessDto } from "@ankify/contracts";
import { useLanguage } from "@/components/LanguageProvider";
import { useAgentShellControls } from "@/components/agent/agent-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { WEAKNESSES_UPDATED_EVENT, notifyWeaknessesUpdated } from "@/lib/agent-events";
import { weaknessCategoryName } from "@/lib/weakness-names";
import { cn, formatRelative } from "@/lib/utils";

/**
 * This problem's weak spots (docs/coach-practice.md, version 2): the specific
 * mistakes the Coach recorded, with how often they happened. Removing one
 * dismisses it; practice resolves them, or the user can.
 */
export function WeakSpots({
  problemId,
  initialWeaknesses,
  className,
}: {
  problemId: string;
  initialWeaknesses?: WeaknessDto[];
  className?: string;
}) {
  const { language, t } = useLanguage();
  const { ask } = useAgentShellControls();
  const [weaknesses, setWeaknesses] = useState<WeaknessDto[] | null>(initialWeaknesses ?? null);
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/problems/${encodeURIComponent(problemId)}/weaknesses`, { cache: "no-store" });
      if (!res.ok) throw new Error(t.weakSpots.loadFailed);
      setWeaknesses(((await res.json()) as { weaknesses: WeaknessDto[] }).weaknesses);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.weakSpots.loadFailed);
    }
  }, [problemId, t.weakSpots.loadFailed]);

  useEffect(() => {
    if (!initialWeaknesses) queueMicrotask(() => void load());
  }, [initialWeaknesses, load]);

  useEffect(() => {
    const reload = (event: Event) => {
      const detail = (event as CustomEvent<{ problemId: string | null }>).detail;
      if (!detail?.problemId || detail.problemId === problemId) void load();
    };
    window.addEventListener(WEAKNESSES_UPDATED_EVENT, reload);
    return () => window.removeEventListener(WEAKNESSES_UPDATED_EVENT, reload);
  }, [load, problemId]);

  async function setStatus(weakness: WeaknessDto, status: WeaknessDto["status"]) {
    setBusy(weakness.id);
    setError(null);
    try {
      const res = await fetch(`/api/weaknesses/${encodeURIComponent(weakness.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(t.weakSpots.actionFailed);
      setWeaknesses((current) =>
        (current ?? [])
          .map((item) => (item.id === weakness.id ? { ...item, status } : item))
          .filter((item) => item.status !== "dismissed"),
      );
      notifyWeaknessesUpdated(problemId);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t.weakSpots.actionFailed);
    } finally {
      setBusy(null);
    }
  }

  if (!weaknesses) {
    return (
      <div className={cn("flex items-center justify-center py-10", className)}>
        {error ? <p className="text-sm text-danger">{error}</p> : <Spinner />}
      </div>
    );
  }

  const active = weaknesses.filter((weakness) => weakness.status === "active");
  const resolved = weaknesses.filter((weakness) => weakness.status === "resolved");

  return (
    <div className={cn("space-y-3", className)}>
      {active.length === 0 && (
        <EmptyState
          title={t.weakSpots.empty}
          action={
            <Button size="sm" onClick={() => ask(t.weakSpots.analyzePrompt, { type: "analyze_attempts" })}>
              {t.weakSpots.analyze}
            </Button>
          }
        />
      )}
      {active.map((weakness) => (
        <WeakSpotRow
          key={weakness.id}
          weakness={weakness}
          name={weaknessCategoryName(weakness.category, weakness.categoryName, language)}
          busy={busy === weakness.id}
          actions={
            <>
              <Button size="xs" variant="ghost" disabled={busy === weakness.id} onClick={() => void setStatus(weakness, "resolved")}>
                {t.weakSpots.resolve}
              </Button>
              <Button size="xs" variant="ghost" disabled={busy === weakness.id} onClick={() => void setStatus(weakness, "dismissed")}>
                {t.weakSpots.remove}
              </Button>
            </>
          }
        />
      ))}
      {resolved.length > 0 && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowResolved((value) => !value)}
            className="text-xs text-muted transition-colors hover:text-fg"
          >
            {showResolved ? t.weakSpots.hideResolved : t.weakSpots.showResolved(resolved.length)}
          </button>
          {showResolved && (
            <div className="mt-2 space-y-2 opacity-75">
              {resolved.map((weakness) => (
                <WeakSpotRow
                  key={weakness.id}
                  weakness={weakness}
                  name={weaknessCategoryName(weakness.category, weakness.categoryName, language)}
                  busy={busy === weakness.id}
                  actions={
                    <Button size="xs" variant="ghost" disabled={busy === weakness.id} onClick={() => void setStatus(weakness, "active")}>
                      {t.weakSpots.reopen}
                    </Button>
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function WeakSpotRow({
  weakness,
  name,
  busy,
  actions,
}: {
  weakness: WeaknessDto;
  name: string;
  busy: boolean;
  actions: React.ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            weakness.status === "active" ? "bg-warning" : "bg-success",
          )}
        />
        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-fg" title={name}>
          {name}
        </p>
        <div className="-my-1 flex shrink-0 items-center gap-0.5">{busy ? <Spinner /> : actions}</div>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-fg">{weakness.detail}</p>
      <p className="mt-1 text-[11px] text-muted tabular-nums">
        {t.weakSpots.timesSeen(weakness.hitCount)} · {t.weakSpots.lastSeen(formatRelative(weakness.lastSeenAt))}
        {weakness.status === "resolved" && ` · ${t.weakSpots.resolved}`}
      </p>
    </div>
  );
}
