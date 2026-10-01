"use client";

import { useCallback, useEffect, useState } from "react";
import type { MistakeListPayloadDto, MistakeRecordDto } from "@ankify/contracts";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill } from "@/components/ui/pill";
import { Spinner } from "@/components/ui/spinner";
import { useLanguage } from "@/components/LanguageProvider";
import { CandidateActions } from "@/components/mistakes/candidate-actions";
import { RecordMistakeDialog } from "@/components/mistakes/record-mistake-dialog";
import {
  MISTAKES_CHANGED_EVENT,
  deleteMistakeRequest,
  updateMistakeRequest,
  type MistakesChangedEvent,
} from "@/lib/mistakes-client";
import { formatRelative } from "@/lib/utils";

type DialogState = { mode: "create" } | { mode: "edit"; mistake: MistakeRecordDto } | null;

/** Mistakes tab of the problem page. Session analysis is the main source:
 *  its open suggestions come first, to confirm, correct, or dismiss. Below
 *  are confirmed records (labeled by origin) with edit, resolve, and delete.
 *  Manual recording is a secondary link. Refreshes when a mistake for this
 *  problem is saved anywhere else on the page. */
export function MistakeList({
  problemId,
  initialMistakes,
}: {
  problemId: string;
  initialMistakes: MistakeRecordDto[];
}) {
  const { t } = useLanguage();
  const [mistakes, setMistakes] = useState(initialMistakes);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingDelete, setPendingDelete] = useState<MistakeRecordDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const read = async (status: "confirmed" | "candidate") => {
      const res = await fetch(`/api/mistakes?problemId=${encodeURIComponent(problemId)}&status=${status}&limit=50`, {
        cache: "no-store",
      }).catch(() => null);
      if (!res?.ok) return null;
      return ((await res.json().catch(() => null)) as MistakeListPayloadDto | null)?.mistakes ?? null;
    };
    const [confirmed, candidates] = await Promise.all([read("confirmed"), read("candidate")]);
    if (confirmed && candidates) setMistakes([...candidates, ...confirmed]);
  }, [problemId]);

  // A decision elsewhere on the page (the Sessions tab) refreshes the page's
  // data; take the new list when it arrives.
  const [received, setReceived] = useState(initialMistakes);
  if (received !== initialMistakes) {
    setReceived(initialMistakes);
    setMistakes(initialMistakes);
  }

  useEffect(() => {
    const handler = (event: Event) => {
      if ((event as MistakesChangedEvent).detail?.problemId === problemId) void refresh();
    };
    window.addEventListener(MISTAKES_CHANGED_EVENT, handler);
    return () => window.removeEventListener(MISTAKES_CHANGED_EVENT, handler);
  }, [problemId, refresh]);

  function replace(updated: MistakeRecordDto) {
    setMistakes((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }

  async function toggleResolved(mistake: MistakeRecordDto) {
    setBusyId(mistake.id);
    setError(null);
    const result = await updateMistakeRequest(mistake.id, { resolved: mistake.resolvedAt === null });
    setBusyId(null);
    if (result.ok) replace(result.mistake);
    else setError(t.common.saveFailed);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusyId(pendingDelete.id);
    setError(null);
    const result = await deleteMistakeRequest(pendingDelete.id);
    setBusyId(null);
    if (!result.ok) {
      setError(t.common.deleteFailed);
      return;
    }
    const deletedId = pendingDelete.id;
    setMistakes((current) => current.filter((item) => item.id !== deletedId));
    setPendingDelete(null);
  }

  // Manual entry is a fallback, so it is a plain link rather than a button.
  const addManually = (
    <button type="button" className="text-sm text-muted underline-offset-2 hover:text-accent hover:underline" onClick={() => setDialog({ mode: "create" })}>
      {t.findings.addManually}
    </button>
  );
  const candidates = mistakes.filter((mistake) => mistake.status === "candidate");
  const confirmed = mistakes.filter((mistake) => mistake.status === "confirmed");

  return (
    <div className="space-y-4">
      {candidates.length > 0 && (
        <section aria-label={t.findings.suggested} className="space-y-2">
          <h3 className="text-sm font-semibold">{t.findings.suggested}</h3>
          <p className="text-xs text-muted">{t.findings.suggestedHelp}</p>
          <ul className="space-y-2">
            {candidates.map((mistake) => (
              <li key={mistake.id} className="space-y-1.5 rounded-lg border border-border bg-subtle/40 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="accent">{t.mistakes.categories[mistake.primaryCategory]}</Pill>
                  <span className="text-xs text-muted">{formatRelative(mistake.createdAt)}</span>
                </div>
                {mistake.summary && <p className="whitespace-pre-line">{mistake.summary}</p>}
                {mistake.nextStep && <p className="whitespace-pre-line text-muted">{t.findings.nextStep(mistake.nextStep)}</p>}
                <CandidateActions mistakeId={mistake.id} category={mistake.primaryCategory} onDecided={() => void refresh()} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {confirmed.length === 0 && candidates.length === 0 ? (
        <EmptyState title={t.mistakes.empty} description={t.mistakes.emptyHelp} action={addManually} />
      ) : (
        <>
          <ul className="divide-y divide-border">
            {confirmed.map((mistake) => (
              <li key={mistake.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="accent">{t.mistakes.categories[mistake.primaryCategory]}</Pill>
                  <Pill>{mistake.origin === "ai_suggested" ? t.findings.fromAnalysis : t.findings.byYou}</Pill>
                  {mistake.suggestedCategory && mistake.suggestedCategory !== mistake.primaryCategory && (
                    <span className="text-xs text-muted">{t.findings.correctedFrom(t.mistakes.categories[mistake.suggestedCategory])}</span>
                  )}
                  {mistake.resolvedAt && <Pill tone="success">{t.mistakes.resolved}</Pill>}
                  <span className="text-xs text-muted">{formatRelative(mistake.createdAt)}</span>
                  <div className="ml-auto flex items-center gap-1">
                    {busyId === mistake.id && <Spinner className="text-muted" />}
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busyId === mistake.id}
                      onClick={() => void toggleResolved(mistake)}
                    >
                      {mistake.resolvedAt ? t.mistakes.markUnresolved : t.mistakes.markResolved}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busyId === mistake.id}
                      onClick={() => setDialog({ mode: "edit", mistake })}
                    >
                      {t.common.edit}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busyId === mistake.id}
                      onClick={() => setPendingDelete(mistake)}
                      className="hover:bg-danger/10 hover:text-danger"
                    >
                      {t.common.delete}
                    </Button>
                  </div>
                </div>
                {mistake.summary && <p className="whitespace-pre-line text-sm">{mistake.summary}</p>}
                {mistake.nextStep && (
                  <p className="whitespace-pre-line text-sm text-muted">
                    <span className="font-medium">{t.mistakes.nextStepLabel}: </span>
                    {mistake.nextStep}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <div>{addManually}</div>
        </>
      )}
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}

      {dialog?.mode === "edit" ? (
        <RecordMistakeDialog
          open
          mode="edit"
          mistake={dialog.mistake}
          problemId={problemId}
          onClose={() => setDialog(null)}
          onSaved={replace}
        />
      ) : (
        <RecordMistakeDialog
          open={dialog?.mode === "create"}
          mode="create"
          source={{ sourceType: "manual" }}
          problemId={problemId}
          onClose={() => setDialog(null)}
        />
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t.mistakes.deleteTitle}
        description={t.mistakes.deleteDescription}
        cancelLabel={t.common.cancel}
        confirmLabel={t.common.delete}
        busy={busyId !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
