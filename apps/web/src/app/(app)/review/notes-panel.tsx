"use client";

import { useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { Markdown } from "@/components/ui/markdown";
import { SaveStatus } from "@/components/ui/save-status";
import { useNotesAutosave } from "@/lib/notes-autosave";

export function NotesEditor({
  notes,
  setNotes,
  problemId,
}: {
  notes: string;
  setNotes: (value: string) => void;
  problemId: string;
}) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const { status, handleChange, flush, retry } = useNotesAutosave({
    problemId,
    value: notes,
    setValue: setNotes,
  });

  const showTextarea = editing || !notes.trim();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="relative flex h-full min-h-[20rem] flex-col rounded-lg border border-border bg-subtle p-3 transition-colors focus-within:border-accent/40">
          {showTextarea ? (
            <textarea
              value={notes}
              onChange={(event) => handleChange(event.target.value)}
              onFocus={() => setEditing(true)}
              onBlur={() => {
                setEditing(false);
                flush();
              }}
              placeholder={t.review.notesPlaceholder}
              className="focus-inset min-h-0 flex-1 w-full resize-none border-0 bg-transparent p-0 text-sm leading-relaxed placeholder:text-muted/50"
              autoFocus={editing}
            />
          ) : (
            <div
              className="min-h-0 flex-1 cursor-text"
              onClick={() => setEditing(true)}
            >
              <Markdown>{notes}</Markdown>
            </div>
          )}
          <SaveStatus status={status} onRetry={retry} className="absolute right-3 top-3" />
        </div>
      </div>
    </div>
  );
}
