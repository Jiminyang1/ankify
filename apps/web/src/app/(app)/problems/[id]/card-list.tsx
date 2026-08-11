"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CardDto } from "@ankify/contracts";
import { Markdown } from "@/components/ui/markdown";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useLanguage } from "@/components/LanguageProvider";

type EditForm = {
  id: string;
  version: number;
  question: string;
  answer: string;
};

export function CardList({ cards }: { cards: CardDto[] }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, startDelete] = useTransition();
  const [saving, startSave] = useTransition();
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  /** Close editor if list refreshed and card disappeared */
  useEffect(() => {
    if (!editForm) return;
    if (cards.some((c) => c.id === editForm.id)) return;
    const timer = window.setTimeout(() => setEditForm(null), 0);
    return () => window.clearTimeout(timer);
  }, [cards, editForm]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const visibleIds = cards.map((c) => c.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = visibleIds.some((id) => selected.has(id));

  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) visibleIds.forEach((id) => next.delete(id));
    else visibleIds.forEach((id) => next.add(id));
    setSelected(next);
  };

  const deleteIds = () => {
    if (pendingDeleteIds.length === 0) return;
    setActionError(null);
    startDelete(async () => {
      const res = await fetch("/api/cards", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: pendingDeleteIds }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setActionError(`${t.common.deleteFailed}: ${j.error ?? res.statusText}`);
        return;
      }
      setSelected(new Set());
      setEditForm(null);
      setPendingDeleteIds([]);
      router.refresh();
    });
  };

  const saveEdit = () => {
    if (!editForm) return;
    setActionError(null);
    startSave(async () => {
      const res = await fetch(`/api/cards/${editForm.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: editForm.version,
          question: editForm.question,
          answer: editForm.answer,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setActionError(`${t.common.saveFailed}: ${j.error ?? res.statusText}`);
        return;
      }
      setEditForm(null);
      router.refresh();
    });
  };

  if (cards.length === 0) return null;
  const selectedCount = selected.size;

  return (
    <div className="space-y-3">
      <ConfirmDialog
        open={pendingDeleteIds.length > 0}
        title={t.detail.deleteCards(pendingDeleteIds.length)}
        description={t.detail.deleteCardsDescription}
        cancelLabel={t.common.cancel}
        confirmLabel={deleting ? t.detail.deleting : t.common.delete}
        busy={deleting}
        error={actionError}
        onClose={() => {
          if (!deleting) {
            setPendingDeleteIds([]);
            setActionError(null);
          }
        }}
        onConfirm={deleteIds}
      />
      <Surface className="flex flex-wrap items-center gap-3 px-3 py-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = !allSelected && someSelected;
            }}
            onChange={toggleAll}
            className="h-4 w-4 cursor-pointer rounded border-border accent-accent"
          />
          <span className="text-muted">
            {selectedCount > 0 ? t.common.selected(selectedCount) : t.common.cards(cards.length)}
          </span>
        </label>

        {selectedCount > 0 && (
          <Button
            variant="danger"
            size="sm"
            disabled={deleting}
            onClick={() => {
              setActionError(null);
              setPendingDeleteIds(Array.from(selected));
            }}
            className="ml-auto"
          >
            {deleting ? t.detail.deleting : `${t.common.delete} ${selectedCount}`}
          </Button>
        )}
      </Surface>

      {actionError && pendingDeleteIds.length === 0 && (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">
          {actionError}
        </p>
      )}

      <ul className="space-y-3">
        {cards.map((c) => {
          const isSelected = selected.has(c.id);
          const isEditing = editForm?.id === c.id;

          return (
            <li key={c.id}>
              <Surface
                className={
                  "p-4 transition " +
                  (isSelected ? "border-accent/50 ring-1 ring-accent/20 " : "")
                }
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(c.id)}
                    aria-label={c.question}
                    className="mt-1 h-4 w-4 cursor-pointer rounded border-border accent-accent"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={deleting || saving}
                          onClick={() =>
                            isEditing
                              ? setEditForm(null)
                              : setEditForm({
                                  id: c.id,
                                  version: c.version,
                                  question: c.question,
                                  answer: c.answer,
                                })
                          }
                          className="text-accent hover:bg-accent/10 hover:text-accent"
                        >
                          {isEditing ? t.common.cancel : t.common.edit}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={deleting || saving}
                          onClick={() => {
                            setActionError(null);
                            setPendingDeleteIds([c.id]);
                          }}
                          aria-label={t.detail.deleteCards(1)}
                          title={t.detail.deleteCards(1)}
                          className="h-7 w-7 text-muted hover:bg-danger/10 hover:text-danger"
                        >
                          ×
                        </Button>
                      </div>
                    </div>

                    {isEditing && editForm ? (
                      <div className="mt-3 space-y-3">
                        <label className="block text-[11px] font-medium uppercase tracking-wide text-muted">
                          {t.review.question}
                          <Textarea
                            value={editForm.question}
                            onChange={(e) => setEditForm({ ...editForm, question: e.target.value })}
                            rows={3}
                            className="mt-1"
                          />
                        </label>
                        <label className="block text-[11px] font-medium uppercase tracking-wide text-muted">
                          {t.review.answer}
                          <Textarea
                            value={editForm.answer}
                            onChange={(e) => setEditForm({ ...editForm, answer: e.target.value })}
                            rows={4}
                            className="mt-1"
                          />
                        </label>
                        <div className="flex justify-end gap-2 pt-1">
                          <Button size="sm" disabled={saving} onClick={() => setEditForm(null)}>
                            {t.common.discard}
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={saving || !editForm.question.trim() || !editForm.answer.trim()}
                            onClick={saveEdit}
                          >
                            {saving ? t.common.saving : t.common.saveChanges}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Markdown className="mt-3 text-sm font-medium">{c.question}</Markdown>
                        <div className="mt-3 rounded-md bg-success/10 px-3 py-2">
                          <Markdown className="text-sm">{c.answer}</Markdown>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </Surface>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
