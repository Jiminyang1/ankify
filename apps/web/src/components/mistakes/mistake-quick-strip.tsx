"use client";

import { useState } from "react";
import type { MistakeRecordDto } from "@ankify/contracts";
import { SKILL_DIMENSIONS, type SkillDimension } from "@ankify/core";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useLanguage } from "@/components/LanguageProvider";
import { createMistakeRequest, notifyMistakesChanged } from "@/lib/mistakes-client";
import { CategoryChips } from "./category-chips";
import { RecordMistakeDialog } from "./record-mistake-dialog";

/**
 * "What went wrong?" after an Again/Hard rating. One tap on a category saves a
 * record linked to that rating; "Add detail" opens the full dialog. Never blocks
 * moving on to the next problem.
 */
export function MistakeQuickStrip({
  problemId,
  reviewRequestId,
}: {
  problemId: string;
  /** The `requestId` of the rating this mistake explains. */
  reviewRequestId: string;
}) {
  const { t } = useLanguage();
  const [requestId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState<SkillDimension | null>(null);
  const [saved, setSaved] = useState<MistakeRecordDto | null>(null);
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (dismissed) return null;

  async function record(category: SkillDimension) {
    if (saving || saved) return;
    setSaving(category);
    setError(null);
    const result = await createMistakeRequest({
      sourceType: "review",
      reviewRequestId,
      requestId,
      problemId,
      primaryCategory: category,
      secondaryTags: [],
    });
    setSaving(null);
    if (!result.ok) {
      setError(t.mistakes.saveFailed);
      return;
    }
    setSaved(result.mistake);
    notifyMistakesChanged(problemId);
  }

  return (
    <div className="mt-6 border-t border-border pt-5 text-left">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{t.mistakes.stripTitle}</p>
        {!saved && <p className="text-xs text-muted">{t.mistakes.stripHint}</p>}
      </div>

      {saved ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-success">{t.mistakes.saved}</span>
          <span className="text-muted">{t.mistakes.categories[saved.primaryCategory]}</span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDialog("edit")}>
            {t.mistakes.addDetail}
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2">
            <CategoryChips
              categories={[...SKILL_DIMENSIONS]}
              selected={saving}
              onSelect={(category) => void record(category)}
              disabled={saving !== null}
              label={t.mistakes.stripTitle}
            />
            {saving && <Spinner className="text-muted" />}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
              {t.mistakes.dismiss}
            </Button>
            <Button size="sm" onClick={() => setDialog("create")}>
              {t.mistakes.addDetail}
            </Button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger" role="alert">{error}</p>}

      {dialog === "edit" && saved ? (
        <RecordMistakeDialog
          open
          mode="edit"
          mistake={saved}
          problemId={problemId}
          onClose={() => setDialog(null)}
          onSaved={setSaved}
        />
      ) : (
        <RecordMistakeDialog
          open={dialog === "create"}
          mode="create"
          source={{ sourceType: "review", reviewRequestId }}
          problemId={problemId}
          onClose={() => setDialog(null)}
          onSaved={setSaved}
        />
      )}
    </div>
  );
}
