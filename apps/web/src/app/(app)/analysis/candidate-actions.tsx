"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** Confirm or dismiss an AI-suggested mistake; only confirmed ones count. */
export function CandidateActions({ mistakeId }: { mistakeId: string }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [busy, setBusy] = useState<"confirmed" | "dismissed" | null>(null);
  const [failed, setFailed] = useState(false);

  async function decide(status: "confirmed" | "dismissed") {
    setBusy(status);
    setFailed(false);
    const response = await fetch(`/api/mistakes/${encodeURIComponent(mistakeId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    setBusy(null);
    if (!response?.ok) return setFailed(true);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {failed && (
        <span role="alert" className="text-xs text-danger">
          {t.profile.decisionFailed}
        </span>
      )}
      <Button size="sm" variant="primary" disabled={busy != null} onClick={() => void decide("confirmed")}>
        {busy === "confirmed" && <Spinner />}
        {t.profile.confirm}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy != null} onClick={() => void decide("dismissed")}>
        {busy === "dismissed" && <Spinner />}
        {t.profile.dismiss}
      </Button>
    </div>
  );
}
