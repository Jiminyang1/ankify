"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MistakeRecordDto } from "@ankify/contracts";
import type { SkillDimension } from "@ankify/core";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { useLanguage } from "@/components/LanguageProvider";
import { useHydrated } from "@/lib/use-hydrated";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import {
  createMistakeRequest,
  notifyMistakesChanged,
  orderedDimensions,
  updateMistakeRequest,
  type MistakeSourceRef,
} from "@/lib/mistakes-client";
import { CategoryChips } from "./category-chips";

export type RecordMistakeDialogProps = {
  open: boolean;
  onClose: () => void;
  problemId: string;
  /** Called after a successful save; `deduplicated` means the same source
   *  already had a record of this category and that record is returned. */
  onSaved?: (mistake: MistakeRecordDto, deduplicated: boolean) => void;
} & (
  | {
      mode: "create";
      source: MistakeSourceRef;
      initialCategory?: SkillDimension | null;
      /** Listed first but not selected, e.g. `complexity` for a TLE. */
      suggestedFirst?: SkillDimension | null;
    }
  | { mode: "edit"; mistake: MistakeRecordDto }
);

/** Create or edit a mistake record. Mounted only while open, so every open
 *  starts from fresh state and a fresh idempotency key. */
export function RecordMistakeDialog(props: RecordMistakeDialogProps) {
  const mounted = useHydrated();
  if (!props.open || !mounted) return null;
  return createPortal(<DialogBody {...props} />, document.body);
}

function DialogBody(props: RecordMistakeDialogProps) {
  const { t } = useLanguage();
  const { onClose, problemId, onSaved } = props;
  const editing = props.mode === "edit" ? props.mistake : null;
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  // One key per dialog session: a retried save can never create a second record.
  const [requestId] = useState(() => crypto.randomUUID());
  const [category, setCategory] = useState<SkillDimension | null>(
    editing?.primaryCategory ?? (props.mode === "create" ? props.initialCategory ?? null : null),
  );
  const [summary, setSummary] = useState(editing?.summary ?? "");
  const [nextStep, setNextStep] = useState(editing?.nextStep ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDialogA11y({ open: true, onClose, containerRef: dialogRef });

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  async function save() {
    if (!category || saving) return;
    setSaving(true);
    setError(null);
    const text = { summary: summary.trim(), nextStep: nextStep.trim() };
    const result = editing
      ? await updateMistakeRequest(editing.id, {
          primaryCategory: category,
          summary: text.summary || null,
          nextStep: text.nextStep || null,
        }).then((edited) => (edited.ok ? { ...edited, deduplicated: false } : edited))
      : await createMistakeRequest({
          ...(props.mode === "create" ? props.source : { sourceType: "manual" as const }),
          requestId,
          problemId,
          primaryCategory: category,
          secondaryTags: [],
          ...(text.summary ? { summary: text.summary } : {}),
          ...(text.nextStep ? { nextStep: text.nextStep } : {}),
        });
    setSaving(false);
    if (!result.ok) {
      setError(result.error === "duplicate_mistake" ? t.mistakes.alreadyRecorded : t.mistakes.saveFailed);
      return;
    }
    notifyMistakesChanged(problemId);
    onSaved?.(result.mistake, result.deduplicated);
    onClose();
  }

  const categories = orderedDimensions(props.mode === "create" ? props.suggestedFirst : null);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6" role="presentation">
      <button
        type="button"
        aria-label={t.common.cancel}
        tabIndex={-1}
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-[101] flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">
            {editing ? t.mistakes.editTitle : t.mistakes.dialogTitle}
          </h2>
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <p className="mb-2 text-sm font-medium">{t.mistakes.categoryLabel}</p>
            <CategoryChips
              categories={categories}
              selected={category}
              onSelect={setCategory}
              disabled={saving}
              showHints
              label={t.mistakes.categoryLabel}
            />
          </div>
          <Field label={t.mistakes.summaryLabel}>
            <Textarea
              rows={3}
              maxLength={2_000}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder={t.mistakes.summaryPlaceholder}
              disabled={saving}
            />
          </Field>
          <Field label={t.mistakes.nextStepLabel}>
            <Textarea
              rows={2}
              maxLength={1_000}
              value={nextStep}
              onChange={(event) => setNextStep(event.target.value)}
              placeholder={t.mistakes.nextStepPlaceholder}
              disabled={saving}
            />
          </Field>
          {error && (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button onClick={onClose} disabled={saving}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!category || saving}>
            {saving && <Spinner />}
            {editing ? t.common.saveChanges : t.mistakes.save}
          </Button>
        </div>
      </div>
    </div>
  );
}
