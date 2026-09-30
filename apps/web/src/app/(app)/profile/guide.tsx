"use client";

import { CircleHelp } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { StatusBar } from "./status-bar";
import { STATUS_SWATCH } from "./status-style";

const DISMISSED_KEY = "ankify.profile.guide-dismissed";
const GUIDE_EVENT = "ankify:profile-guide";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(GUIDE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(GUIDE_EVENT, onChange);
  };
}

function readDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function setDismissed(dismissed: boolean) {
  try {
    if (dismissed) localStorage.setItem(DISMISSED_KEY, "1");
    else localStorage.removeItem(DISMISSED_KEY);
  } catch {
    /* storage blocked: the guide just shows again next visit */
  }
  window.dispatchEvent(new Event(GUIDE_EVENT));
}

const EXAMPLE = { remembered: 4, due: 1, solved: 10, todo: 9 };

/** First-visit explainer for the roadmap's three concepts. Once dismissed it
 *  collapses to a "How to read this" link. */
export function ProfileGuide({ solvedSynced }: { solvedSynced: boolean }) {
  const { t } = useLanguage();
  const copy = t.profile.guide;
  // Server render assumes dismissed so returning visitors never see a flash.
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => true);

  if (dismissed) {
    return (
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => setDismissed(false)}>
          <CircleHelp aria-hidden="true" className="h-3.5 w-3.5" />
          {copy.reopen}
        </Button>
      </div>
    );
  }

  const steps = [
    { swatch: STATUS_SWATCH.solved, title: copy.solvedTitle, body: copy.solvedBody, note: solvedSynced ? null : copy.solvedMissing },
    { swatch: STATUS_SWATCH.remembered, title: copy.rememberedTitle, body: copy.rememberedBody, note: null },
    { swatch: STATUS_SWATCH.due, title: copy.dueTitle, body: copy.dueBody, note: null },
  ];

  return (
    <Surface as="section" aria-labelledby="profile-guide-title" className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <h2 id="profile-guide-title" className="text-base font-semibold">
          {copy.title}
        </h2>
        <Button variant="secondary" size="sm" onClick={() => setDismissed(true)}>
          {copy.dismiss}
        </Button>
      </div>

      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="rounded-lg border border-border bg-bg/40 p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-subtle text-[11px] font-semibold tabular-nums text-muted">
                {index + 1}
              </span>
              <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-[3px]", step.swatch)} />
              <span className="text-sm font-semibold">{step.title}</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted">{step.body}</p>
            {step.note && <p className="mt-2 text-xs font-medium text-warning">{step.note}</p>}
          </li>
        ))}
      </ol>

      <div className="mt-3 flex flex-col gap-4 rounded-lg border border-dashed border-border p-4 sm:flex-row sm:items-center">
        <div aria-hidden="true" className="w-full shrink-0 rounded-xl border border-border bg-surface px-3 py-2.5 shadow-card sm:w-[168px]">
          <div className="truncate text-[13px] font-medium">Array / String</div>
          <StatusBar counts={EXAMPLE} total={24} className="mt-2 h-1.5" />
          <div className="mt-1.5 flex gap-2 text-[11px]">
            <span className="tabular-nums text-muted">15/24</span>
            <span className="font-medium text-warning">{t.profile.nodeDue(1)}</span>
          </div>
        </div>
        <div>
          <div className="text-sm font-semibold">{copy.nodeTitle}</div>
          <p className="mt-1 text-sm leading-6 text-muted">{copy.nodeBody}</p>
        </div>
      </div>
    </Surface>
  );
}
