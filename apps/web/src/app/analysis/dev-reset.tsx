"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Dev-only "wipe everything" button. The server route also enforces
 *  NODE_ENV !== "production", so this is double-guarded. */
export function DevResetButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  const onClick = () => {
    const ok = window.confirm(
      "Wipe ALL problems, cards, submissions, and review history?\n\n" +
        "Settings (API keys / model) are kept. This cannot be undone.",
    );
    if (!ok) return;

    startTransition(async () => {
      setStatus(null);
      const res = await fetch("/api/dev/reset", { method: "POST" });
      if (!res.ok) {
        setStatus(`Failed: ${res.status}`);
        return;
      }
      setStatus("Wiped. Reloading…");
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/15 disabled:opacity-50"
      >
        {pending ? "Wiping…" : "Reset all data"}
      </button>
      {status && <span className="text-xs text-muted">{status}</span>}
    </div>
  );
}
