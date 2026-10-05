import { useCallback, useEffect, useState } from "react";
import type { ProblemDocsDto, ProblemDocTarget } from "@ankify/contracts";
import type { ExtSettings } from "../shared/messages";
import { apiFetch } from "./api";
import { PopupMarkdown } from "./PopupMarkdown";

export type DocsCopy = {
  notes: string;
  cards: string;
  edit: string;
  save: string;
  cancel: string;
  reload: string;
  emptyNotes: string;
  emptyCards: string;
  cardsFormat: string;
  conflict: string;
  loadFailed: string;
  saveFailed: string;
  issueEmptyAnswer: (prompt: string) => string;
  issueDuplicate: (prompt: string) => string;
  issueTooMany: (limit: number) => string;
  issueTooLong: (limit: number) => string;
};

/** The problem's Notes and Cards docs (docs/coach-practice.md): rendered,
 *  with an edit mode. Saves are version-checked, so an edit can't silently
 *  overwrite a Coach change applied meanwhile. `revision` bumps when the Coach
 *  applies an edit. */
export function DocsPanel({
  settings,
  problemId,
  revision,
  copy,
}: {
  settings: ExtSettings;
  problemId: string;
  revision: number;
  copy: DocsCopy;
}) {
  const [docs, setDocs] = useState<ProblemDocsDto | null>(null);
  const [target, setTarget] = useState<ProblemDocTarget>("notes");
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; conflict: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(settings, `/api/problems/${problemId}/docs`, { cache: "no-store" });
      if (!res.ok) throw new Error(copy.loadFailed);
      setDocs(((await res.json()) as { docs: ProblemDocsDto }).docs);
    } catch (loadError) {
      setError({ message: loadError instanceof Error ? loadError.message : copy.loadFailed, conflict: false });
    }
  }, [copy.loadFailed, problemId, settings]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  const doc = docs ? docs[target] : null;
  const editing = draft !== null;

  function startEdit() {
    if (!doc) return;
    setError(null);
    setDraft(doc.markdown);
  }

  async function save() {
    if (!doc || draft === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(settings, `/api/problems/${problemId}/docs`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target, markdown: draft, expectedVersion: doc.version }),
      });
      const body = (await res.json().catch(() => null)) as { docs?: ProblemDocsDto; error?: string } | null;
      if (res.status === 409) {
        setError({ message: copy.conflict, conflict: true });
        return;
      }
      if (!res.ok || !body?.docs) throw new Error(body?.error ?? copy.saveFailed);
      setDocs(body.docs);
      setDraft(null);
    } catch (saveError) {
      setError({ message: saveError instanceof Error ? saveError.message : copy.saveFailed, conflict: false });
    } finally {
      setSaving(false);
    }
  }

  function reloadLatest() {
    setDraft(null);
    setError(null);
    void load();
  }

  return (
    <div className="docs-panel">
      <div className="docs-head">
        <div className="docs-switch" role="tablist" aria-label={`${copy.notes} / ${copy.cards}`}>
          {(["notes", "cards"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={target === key}
              data-active={target === key}
              disabled={editing}
              onClick={() => setTarget(key)}
            >
              {key === "notes" ? copy.notes : `${copy.cards}${docs ? ` · ${docs.cards.cards.length}` : ""}`}
            </button>
          ))}
        </div>
        {editing ? (
          <div className="docs-actions">
            <button type="button" className="btn-xs" disabled={saving} onClick={() => setDraft(null)}>
              {copy.cancel}
            </button>
            <button type="button" className="btn-xs btn-xs-accent" disabled={saving} onClick={() => void save()}>
              {saving && <span className="btn-spinner" />}
              {copy.save}
            </button>
          </div>
        ) : (
          <button type="button" className="btn-xs" disabled={!doc} onClick={startEdit}>
            {copy.edit}
          </button>
        )}
      </div>

      {error && (
        <div className="err-banner docs-error">
          {error.message}
          {error.conflict && (
            <button type="button" className="btn-xs" onClick={reloadLatest}>
              {copy.reload}
            </button>
          )}
        </div>
      )}

      {editing ? (
        <>
          {target === "cards" && <p className="docs-hint">{copy.cardsFormat}</p>}
          <textarea
            className="textarea-card docs-editor scroll-area"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={target === "notes" ? copy.notes : copy.cards}
          />
        </>
      ) : !docs ? (
        <p className="popup-muted coach-thinking">
          <span className="btn-spinner" />
        </p>
      ) : target === "notes" ? (
        docs.notes.markdown.trim() ? (
          <PopupMarkdown className="docs-body">{docs.notes.markdown}</PopupMarkdown>
        ) : (
          <p className="popup-muted">{copy.emptyNotes}</p>
        )
      ) : (
        <div className="docs-cards">
          {docs.cards.issues.map((issue, index) => (
            <p key={index} className="docs-issue">
              {issue.kind === "empty_answer"
                ? copy.issueEmptyAnswer(issue.prompt)
                : issue.kind === "duplicate_prompt"
                  ? copy.issueDuplicate(issue.prompt)
                  : issue.kind === "too_many_cards"
                    ? copy.issueTooMany(issue.limit)
                    : copy.issueTooLong(issue.limit)}
            </p>
          ))}
          {docs.cards.cards.length === 0 ? (
            <p className="popup-muted">{copy.emptyCards}</p>
          ) : (
            docs.cards.cards.map((card) => (
              <details key={card.key} className="docs-card">
                <summary>
                  <PopupMarkdown className="popup-md-inline">{card.prompt}</PopupMarkdown>
                </summary>
                <PopupMarkdown className="docs-card-answer">{card.answer}</PopupMarkdown>
              </details>
            ))
          )}
        </div>
      )}
    </div>
  );
}
