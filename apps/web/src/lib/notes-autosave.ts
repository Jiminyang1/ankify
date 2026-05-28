import { useCallback, useEffect, useRef, useState } from "react";

/** Per-problem notes draft persisted in localStorage. `dirty` means the value
 *  hasn't been confirmed by the server yet — the editor uses it on mount to
 *  recover from refresh / crash / failed save without losing keystrokes. */
type NotesDraft = { value: string; dirty: boolean; ts: number };

function notesDraftKey(problemId: string) {
  return `ankify.notes-draft.${problemId}`;
}

export function readNotesDraft(problemId: string): NotesDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(notesDraftKey(problemId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NotesDraft;
    if (typeof parsed?.value !== "string" || typeof parsed?.dirty !== "boolean") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeNotesDraft(problemId: string, value: string, dirty: boolean) {
  if (typeof window === "undefined") return;
  try {
    const payload: NotesDraft = { value, dirty, ts: Date.now() };
    window.localStorage.setItem(notesDraftKey(problemId), JSON.stringify(payload));
  } catch {
    // localStorage can throw on quota / private mode — typing should never break
  }
}

export type NotesSaveStatus = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_DEBOUNCE_MS = 1200;

/**
 * Local-first notes autosave. Every keystroke writes synchronously to
 * localStorage (so typing never blocks on network and unsaved drafts survive
 * refresh / crash), and a debounced PATCH syncs to the server. A failed save
 * surfaces `status === "error"` and leaves the draft marked dirty so `retry()`
 * (or the next keystroke) can re-send it — notes are never silently lost.
 *
 * `value`/`setValue` are owned by the caller so the same notes can be lifted
 * into a parent (e.g. submitted alongside a review rating).
 */
export function useNotesAutosave({
  problemId,
  value,
  setValue,
}: {
  problemId: string;
  value: string;
  setValue: (value: string) => void;
}) {
  const [status, setStatus] = useState<NotesSaveStatus>("idle");
  const savedRef = useRef(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(
    async (next: string) => {
      if (next === savedRef.current) return;
      setStatus("saving");
      try {
        const res = await fetch(`/api/problems/${problemId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ notes: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        savedRef.current = next;
        writeNotesDraft(problemId, next, false);
        setStatus("saved");
        setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1200);
      } catch {
        // Keep the draft marked dirty so retry / next keystroke re-sends it.
        setStatus("error");
      }
    },
    [problemId],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // On problem change, treat the incoming server value as the synced baseline,
  // then recover any dirty local draft (e.g. a save that failed before unmount).
  useEffect(() => {
    savedRef.current = value;
    const draft = readNotesDraft(problemId);
    if (draft && draft.dirty && draft.value !== value) {
      setValue(draft.value);
      void persist(draft.value);
    } else if (draft && !draft.dirty && draft.value !== value) {
      // Server value diverged from last-synced draft (edited elsewhere).
      writeNotesDraft(problemId, value, false);
    }
    // Only re-run when the active problem changes; typing flows through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemId]);

  const handleChange = useCallback(
    (next: string) => {
      setValue(next);
      writeNotesDraft(problemId, next, true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void persist(next), AUTOSAVE_DEBOUNCE_MS);
    },
    [problemId, persist, setValue],
  );

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void persist(value);
  }, [persist, value]);

  const retry = useCallback(() => {
    void persist(value);
  }, [persist, value]);

  return { status, handleChange, flush, retry };
}
