"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SkillDimensionId } from "@ankify/contracts";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

const CATEGORIES: SkillDimensionId[] = ["approach", "invariant", "edge_case", "complexity", "implementation", "conceptual", "other"];

/**
 * Confirm (optionally in a corrected category) or dismiss an AI-suggested
 * mistake. Only confirmed ones count toward the profile; a correction keeps
 * the suggested category on record so the two stay distinguishable.
 */
export function CandidateActions({
  mistakeId,
  category,
  onDecided,
}: {
  mistakeId: string;
  category: SkillDimensionId;
  onDecided?: () => void;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const [selected, setSelected] = useState<SkillDimensionId>(category);
  const [busy, setBusy] = useState<"confirmed" | "dismissed" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(status: "confirmed" | "dismissed") {
    setBusy(status);
    setError(null);
    const body = status === "confirmed" && selected !== category ? { status, primaryCategory: selected } : { status };
    const response = await fetch(`/api/mistakes/${encodeURIComponent(mistakeId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(null);
    if (!response?.ok) {
      const code = ((await response?.json().catch(() => null)) as { error?: string } | null)?.error;
      setError(code === "duplicate_mistake" ? t.findings.duplicate : code === "mistake_not_found" ? t.findings.gone : t.findings.decisionFailed);
      return;
    }
    onDecided?.();
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label={t.findings.categoryAria} value={selected} onValueChange={(value) => setSelected(value as SkillDimensionId)} disabled={busy != null} className="w-auto">
        {CATEGORIES.map((item) => (
          <option key={item} value={item}>
            {t.mistakes.categories[item]}
          </option>
        ))}
      </Select>
      <Button size="sm" variant="primary" disabled={busy != null} onClick={() => void decide("confirmed")}>
        {busy === "confirmed" && <Spinner />}
        {t.findings.confirm}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy != null} onClick={() => void decide("dismissed")}>
        {busy === "dismissed" && <Spinner />}
        {t.findings.dismiss}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
