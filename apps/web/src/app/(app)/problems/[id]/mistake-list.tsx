"use client";

import { useCallback, useEffect, useState } from "react";
import type { MistakeListPayloadDto, MistakeRecordDto } from "@ankify/contracts";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill } from "@/components/ui/pill";
import { Spinner } from "@/components/ui/spinner";
import { useLanguage } from "@/components/LanguageProvider";
import { RecordMistakeDialog } from "@/components/mistakes/record-mistake-dialog";
import {
  MISTAKES_CHANGED_EVENT,
  deleteMistakeRequest,
  updateMistakeRequest,
  type MistakesChangedEvent,
} from "@/lib/mistakes-client";
import { formatRelative } from "@/lib/utils";

type DialogState = { mode: "create" } | { mode: "edit"; mistake: MistakeRecordDto } | null;

/** Mistakes tab of the problem page: confirmed records with edit, resolve,
 *  and delete, plus manual recording. Refreshes when a mistake for this
 *  problem is saved anywhere else on the page (e.g. from a submission). */
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
    const res = await fetch(`/api/mistakes?problemId=${encodeURIComponent(problemId)}&limit=50`, {
      cache: "no-store",
    }).catch(() => null);
    if (!res?.ok) return;
    const json = (await res.json().catch(() => null)) as MistakeListPayloadDto | null;
    if (json) setMistakes(json.mistakes);
  }, [problemId]);

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

  const recordButton = (
    <Button size="sm" onClick={() => setDialog({ mode: "create" })}>
      {t.mistakes.record}
    </Button>
  );

  return (
    <div className="space-y-4">
      {mistakes.length === 0 ? (
        <EmptyState title={t.mistakes.empty} description={t.mistakes.emptyHelp} action={recordButton} />
      ) : (
        <>
          <div className="flex justify-end">{recordButton}</div>
          <ul className="divide-y divide-border">
            {mistakes.map((mistake) => (
              <li key={mistake.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="accent">{t.mistakes.categories[mistake.primaryCategory]}</Pill>
                  <Pill>{t.mistakes.sources[mistake.sourceType]}</Pill>
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
