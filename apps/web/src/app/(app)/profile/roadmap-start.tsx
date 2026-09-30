"use client";

import { Chrome, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { Button, buttonClasses } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Surface } from "@/components/ui/surface";

/** A first session a new user can finish: well under the default daily
 *  review limit of 20. The rest of the pattern stays one click away. */
const FIRST_BATCH = 10;

/**
 * The first step on the roadmap, shown only while the user has nothing from
 * this plan in review:
 * - `start`: LeetCode history is synced, so offer the first pattern's solved
 *   problems in one click.
 * - `connect`: nothing synced yet, so point at the extension.
 */
export function RoadmapStart(
  props:
    | {
        kind: "start";
        plan: string;
        solved: number;
        total: number;
        group: { name: string; slugs: string[] };
      }
    | { kind: "connect"; installUrl: string },
) {
  const { t } = useLanguage();
  const copy = t.profile.start;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  if (props.kind === "connect") {
    return (
      <Surface className="flex flex-col gap-4 border-accent/25 bg-accent-soft/20 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{copy.connectTitle}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">{copy.connectBody}</p>
        </div>
        <a
          href={props.installUrl}
          target="_blank"
          rel="noreferrer"
          className={buttonClasses({ variant: "primary", size: "md", className: "shrink-0" })}
        >
          <Chrome aria-hidden="true" className="size-4" />
          {copy.install}
        </a>
      </Surface>
    );
  }

  const slugs = props.group.slugs.slice(0, FIRST_BATCH);

  async function add() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/profile/add-to-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slugs }),
      });
      const body = (await res.json().catch(() => null)) as { added?: string[] } | null;
      if (!res.ok || !body?.added?.length) setFailed(true);
      startRefresh(() => router.refresh());
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Surface className="border-accent/25 bg-accent-soft/20 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Sparkles aria-hidden="true" className="size-4 text-accent" />
            {copy.title}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            {copy.body(props.solved, props.total, props.plan, props.group.name, slugs.length, props.group.slugs.length)}
          </p>
          <p className="mt-1 text-xs text-muted">{copy.orPick}</p>
        </div>
        <Button variant="primary" className="shrink-0" disabled={busy || refreshing} onClick={() => void add()}>
          {(busy || refreshing) && <Spinner />}
          {copy.add(slugs.length)}
        </Button>
      </div>
      {failed && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {copy.failed}
        </p>
      )}
    </Surface>
  );
}
