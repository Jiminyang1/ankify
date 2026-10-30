"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ProblemDocsDto } from "@ankify/contracts";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Markdown } from "@/components/ui/markdown";
import { Spinner } from "@/components/ui/spinner";
import { PROBLEM_DOCS_UPDATED_EVENT } from "@/lib/agent-events";
import { cn } from "@/lib/utils";

export type DocTarget = "notes" | "solutions";

/**
 * A problem's two docs (docs/coach-practice.md): Notes and Solutions,
 * rendered, with an edit mode. Saves are version-checked, so an edit can't
 * silently overwrite a Coach change applied meanwhile; an applied Coach edit
 * reloads them. The same docs the extension's book icon shows.
 *
 * The parent's tab row picks the doc (`target`) and holds `actionsSlot`, where
 * Edit / Save render. A draft belongs to its doc, so switching docs mid-edit
 * keeps it for when you return.
 */
export function ProblemDocs({
  problemId,
  initialDocs,
  target,
  actionsSlot,
  className,
}: {
  problemId: string;
  initialDocs?: ProblemDocsDto | null;
  target: DocTarget;
  actionsSlot: HTMLElement | null;
  className?: string;
}) {
  const { t } = useLanguage();
  const [docs, setDocs] = useState<ProblemDocsDto | null>(initialDocs ?? null);
  const [draft, setDraft] = useState<{ target: DocTarget; markdown: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; conflict: boolean } | null>(null);
  const editing = draft?.target === target;

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/problems/${encodeURIComponent(problemId)}/docs`, { cache: "no-store" });
      if (!res.ok) throw new Error(t.docs.loadFailed);
      setDocs(((await res.json()) as { docs: ProblemDocsDto }).docs);
    } catch (loadError) {
      setError({ message: loadError instanceof Error ? loadError.message : t.docs.loadFailed, conflict: false });
    }
  }, [problemId, t.docs.loadFailed]);

  useEffect(() => {
    if (!initialDocs) queueMicrotask(() => void load());
  }, [initialDocs, load]);

  // A Coach edit applied from the sidebar. An open editor keeps its draft; its
  // save then reports the newer version.
  useEffect(() => {
    const reload = (event: Event) => {
      const detail = (event as CustomEvent<{ problemId: string }>).detail;
      if (detail?.problemId === problemId && !draft) void load();
    };
    window.addEventListener(PROBLEM_DOCS_UPDATED_EVENT, reload);
    return () => window.removeEventListener(PROBLEM_DOCS_UPDATED_EVENT, reload);
  }, [draft, load, problemId]);

  const doc = docs ? docs[target] : null;

  async function save() {
    if (!doc || !editing || !draft || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/problems/${encodeURIComponent(problemId)}/docs`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target, markdown: draft.markdown, expectedVersion: doc.version }),
      });
      const body = (await res.json().catch(() => null)) as { docs?: ProblemDocsDto; error?: string } | null;
      if (res.status === 409) {
        setError({ message: t.docs.conflict, conflict: true });
        return;
      }
      if (!res.ok || !body?.docs) throw new Error(t.docs.saveFailed);
      setDocs(body.docs);
      setDraft(null);
    } catch (saveError) {
      setError({ message: saveError instanceof Error ? saveError.message : t.docs.saveFailed, conflict: false });
    } finally {
      setSaving(false);
    }
  }

  function reloadLatest() {
    setDraft(null);
    setError(null);
    void load();
  }

  const actions = editing ? (
    <div className="flex items-center gap-2">
      <span className="hidden text-[11px] text-muted sm:inline">{t.docs.saveHint}</span>
      <Button size="xs" variant="ghost" disabled={saving} onClick={() => setDraft(null)}>
        {t.docs.cancel}
      </Button>
      <Button size="xs" variant="primary" disabled={saving} onClick={() => void save()}>
        {saving && <Spinner />}
        {t.docs.save}
      </Button>
    </div>
  ) : (
    <Button
      size="xs"
      disabled={!doc}
      onClick={() => {
        if (!doc) return;
        setError(null);
        setDraft({ target, markdown: doc.markdown });
      }}
    >
      {t.docs.edit}
    </Button>
  );

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {actionsSlot && createPortal(actions, actionsSlot)}

      {error && docs && (
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-lg border border-danger/25 bg-danger/8 px-3 py-2 text-xs text-danger">
          <span>{error.message}</span>
          {error.conflict && (
            <Button size="xs" onClick={reloadLatest}>
              {t.docs.reload}
            </Button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {editing && draft ? (
          <div className="flex h-full min-h-[320px] flex-col gap-2">
            {target === "solutions" && <p className="text-[11px] text-muted">{t.docs.solutionsFormat}</p>}
            {/* Same type as the rendered Markdown, so switching to edit doesn't jump. */}
            <textarea
              value={draft.markdown}
              autoFocus
              onChange={(event) => setDraft({ target, markdown: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void save();
                } else if (event.key === "Escape" && !saving) {
                  event.preventDefault();
                  setDraft(null);
                }
              }}
              aria-label={t.docs[target]}
              className="focus-inset min-h-[280px] flex-1 resize-none rounded-lg border border-border bg-bg px-3 py-2 text-sm leading-relaxed text-fg outline-none"
            />
          </div>
        ) : !docs ? (
          <div className="flex h-full items-center justify-center">
            {error ? (
              <EmptyState
                title={error.message}
                action={
                  <Button size="sm" onClick={() => void load()}>
                    {t.common.retry}
                  </Button>
                }
              />
            ) : (
              <Spinner />
            )}
          </div>
        ) : target === "notes" ? (
          docs.notes.markdown.trim() ? (
            <Markdown>{docs.notes.markdown}</Markdown>
          ) : (
            <EmptyState title={t.docs.emptyNotes} />
          )
        ) : (
          <SolutionsView docs={docs} />
        )}
      </div>
    </div>
  );
}

function SolutionsView({ docs }: { docs: ProblemDocsDto }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-3">
      {docs.solutions.issues.map((issue, index) => (
        <p key={index} className="text-xs text-warning">
          {issue.kind === "no_points"
            ? t.docs.issueNoPoints(issue.approach)
            : issue.kind === "too_many_points"
              ? t.docs.issueTooManyPoints(issue.approach, issue.limit)
              : issue.kind === "too_many_approaches"
                ? t.docs.issueTooManyApproaches(issue.limit)
                : t.docs.issueTooLong(issue.limit)}
        </p>
      ))}
      {docs.solutions.approaches.length === 0 ? (
        <EmptyState title={t.docs.emptySolutions} />
      ) : (
        docs.solutions.approaches.map((approach) => (
          <section key={approach.id} className="rounded-lg border border-border bg-surface px-3 py-2.5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
              {approach.name}
              {approach.mine && (
                <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                  {t.docs.mine}
                </span>
              )}
            </h3>
            <ul className="mt-1.5 ml-4 list-disc space-y-1 text-sm leading-relaxed marker:text-muted">
              {approach.points.map((point, index) => (
                <li key={index} className="pl-1 [&_p]:inline">
                  <Markdown className="inline">{point}</Markdown>
                </li>
              ))}
            </ul>
            {approach.complexity && (
              <div className="mt-1.5 text-xs text-muted [&_p]:inline [&_p]:text-xs">
                {t.docs.complexity}: <Markdown className="inline">{approach.complexity}</Markdown>
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}
