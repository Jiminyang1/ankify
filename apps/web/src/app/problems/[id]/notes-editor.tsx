"use client";

import { useState } from "react";
import { Markdown } from "@/components/ui/markdown";
import { SaveStatus } from "@/components/ui/save-status";
import { useNotesAutosave } from "@/lib/notes-autosave";

/**
 * Editable notes panel for the problem detail page. Click-to-edit with a
 * debounced, local-first autosave (see useNotesAutosave) that surfaces a
 * visible retry affordance when a save fails so notes are never silently lost.
 */
export function NotesEditor({
  problemId,
  initialNotes,
}: {
  problemId: string;
  initialNotes: string;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [editing, setEditing] = useState(false);
  const { status, handleChange, flush, retry } = useNotesAutosave({
    problemId,
    value: notes,
    setValue: setNotes,
  });

  const showTextarea = editing || !notes.trim();

  return (
    <div className="space-y-2">
      <div className="relative flex min-h-[18rem] flex-col rounded-lg border border-border bg-subtle p-3 transition-colors focus-within:border-accent/40">
        {showTextarea ? (
          <textarea
            value={notes}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => setEditing(true)}
            onBlur={() => {
              setEditing(false);
              flush();
            }}
            placeholder="Markdown notes — what to remember, what changed, open questions..."
            className="min-h-[16rem] flex-1 w-full resize-y border-0 bg-transparent p-0 text-sm leading-relaxed placeholder:text-muted/50 focus:outline-none focus:ring-0"
            autoFocus={editing}
          />
        ) : (
          <div className="min-h-0 flex-1 cursor-text" onClick={() => setEditing(true)}>
            <Markdown>{notes}</Markdown>
          </div>
        )}
        <SaveStatus status={status} onRetry={retry} className="absolute right-3 top-3" />
      </div>
    </div>
  );
}
