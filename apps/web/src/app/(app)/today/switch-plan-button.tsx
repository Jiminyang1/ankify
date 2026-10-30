"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** Switches the current plan (the Plan page's switch), then refreshes Today. */
export function SwitchPlanButton({ plan }: { plan: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();

  async function switchPlan() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/study-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) throw new Error("switch_failed");
      startRefresh(() => router.refresh());
    } catch {
      setError(t.planNext.switchFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <Button variant="primary" size="sm" disabled={busy || refreshing} onClick={() => void switchPlan()}>
        {(busy || refreshing) && <Spinner />}
        {t.planNext.switchPlan}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
