"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/components/LanguageProvider";

/** Archive removes the problem from the review rotation but keeps notes,
 *  cards, submissions, and review history. Reversible, so no confirm modal. */
export function ArchiveProblemButton({
  problemId,
  archived,
}: {
  problemId: string;
  archived: boolean;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleArchive() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/problems/${problemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived: !archived }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.detail.archiveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={toggleArchive} disabled={busy} title={archived ? t.detail.unarchiveHint : t.detail.archiveHint}>
        {busy ? "…" : archived ? t.detail.unarchive : t.detail.archive}
      </Button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </>
  );
}
