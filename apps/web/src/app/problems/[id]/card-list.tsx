"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Card } from "@ankify/db";
import { Markdown } from "@/components/ui/markdown";
import { Surface } from "@/components/ui/surface";

type EditForm = {
  id: string;
  question: string;
  answer: string;
};

export function CardList({ cards, problemId }: { cards: Card[]; problemId: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, startDelete] = useTransition();
  const [saving, startSave] = useTransition();
  const [editForm, setEditForm] = useState<EditForm | null>(null);

  /** Close editor if list refreshed and card disappeared */
  useEffect(() => {
    if (!editForm) return;
    if (!cards.some((c) => c.id === editForm.id)) setEditForm(null);
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

  const deleteIds = (ids: string[], confirmText: string) => {
    if (ids.length === 0) return;
    if (!window.confirm(confirmText)) return;
    startDelete(async () => {
      const res = await fetch("/api/cards", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        window.alert(`Delete failed: ${j.error ?? res.statusText}`);
        return;
      }
      setSelected(new Set());
      setEditForm(null);
      router.refresh();
    });
  };

  const saveEdit = () => {
    if (!editForm) return;
    startSave(async () => {
      const res = await fetch(`/api/cards/${editForm.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: editForm.question,
          answer: editForm.answer,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        window.alert(`Save failed: ${j.error ?? res.statusText}`);
        return;
      }
      setEditForm(null);
      router.refresh();
    });
  };

  if (cards.length === 0) return null;
  const selectedCount = selected.size;

  return (
    <div className="mt-4 space-y-3">
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
            {selectedCount > 0 ? `${selectedCount} selected` : `${cards.length} card${cards.length === 1 ? "" : "s"}`}
          </span>
        </label>

        {selectedCount > 0 && (
          <button
            type="button"
            disabled={deleting}
            onClick={() =>
              deleteIds(
                Array.from(selected),
                `Delete ${selectedCount} card${selectedCount === 1 ? "" : "s"}? This cannot be undone.`,
              )
            }
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/15 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : `Delete ${selectedCount}`}
          </button>
        )}
      </Surface>

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
                    className="mt-1 h-4 w-4 cursor-pointer rounded border-border accent-accent"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={deleting || saving}
                          onClick={() =>
                            isEditing
                              ? setEditForm(null)
                              : setEditForm({
                                  id: c.id,
                                  question: c.question,
                                  answer: c.answer,
                                })
                          }
                          className="rounded-md px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
                        >
                          {isEditing ? "Cancel" : "Edit"}
                        </button>
                        <button
                          type="button"
                          disabled={deleting || saving}
                          onClick={() => deleteIds([c.id], "Delete this card? This cannot be undone.")}
                          aria-label="Delete card"
                          title="Delete card"
                          className="grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    {isEditing && editForm ? (
                      <div className="mt-3 space-y-3">
                        <label className="block text-[11px] font-medium uppercase tracking-wide text-muted">
                          Question
                          <textarea
                            value={editForm.question}
                            onChange={(e) => setEditForm({ ...editForm, question: e.target.value })}
                            rows={3}
                            className="mt-1 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent/40"
                          />
                        </label>
                        <label className="block text-[11px] font-medium uppercase tracking-wide text-muted">
                          Answer
                          <textarea
                            value={editForm.answer}
                            onChange={(e) => setEditForm({ ...editForm, answer: e.target.value })}
                            rows={4}
                            className="mt-1 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent/40"
                          />
                        </label>
                        <div className="flex justify-end gap-2 pt-1">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => setEditForm(null)}
                            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-subtle disabled:opacity-50"
                          >
                            Discard
                          </button>
                          <button
                            type="button"
                            disabled={saving || !editForm.question.trim() || !editForm.answer.trim()}
                            onClick={saveEdit}
                            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-card hover:opacity-90 disabled:opacity-50"
                          >
                            {saving ? "Saving…" : "Save changes"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="mt-3 text-sm font-medium">{c.question}</p>
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
