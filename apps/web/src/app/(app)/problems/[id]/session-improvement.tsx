"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

const CATEGORIES = ["approach", "invariant", "edge_case", "complexity", "implementation", "conceptual", "other"] as const;

/** Confirms that a completed session handled a skill dimension well. */
export function SessionImprovement({ sessionId, confirmed }: { sessionId: string; confirmed: string[] }) {
  const router = useRouter();
  const { t } = useLanguage();
  const id = useId();
  const options = CATEGORIES.filter((category) => !confirmed.includes(category));
  const [choice, setChoice] = useState<string>(options[0] ?? "");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  if (options.length === 0) return null;
  // A choice confirmed meanwhile is no longer offered.
  const category = options.includes(choice as (typeof options)[number]) ? choice : options[0]!;

  async function confirm() {
    setSaving(true);
    setFailed(false);
    const response = await fetch("/api/mistakes/improvements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: crypto.randomUUID(), practiceSessionId: sessionId, category }),
    }).catch(() => null);
    setSaving(false);
    if (!response?.ok) return setFailed(true);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="text-xs text-muted">
        {t.sessions.chooseCategory}
      </label>
      <Select id={id} value={category} onValueChange={setChoice} className="w-auto text-xs">
        {options.map((option) => (
          <option key={option} value={option}>
            {t.mistakes.categories[option]}
          </option>
        ))}
      </Select>
      <Button size="sm" variant="secondary" disabled={saving} onClick={() => void confirm()}>
        {saving && <Spinner />}
        {t.sessions.confirmImprovement}
      </Button>
      {failed && (
        <span role="alert" className="text-xs text-danger">
          {t.sessions.improvementFailed}
        </span>
      )}
    </div>
  );
}
