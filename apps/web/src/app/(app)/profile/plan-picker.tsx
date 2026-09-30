"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { useHydrated } from "@/lib/use-hydrated";

type PlanOption = { slug: string; name: string; custom: boolean };
type ImportError = keyof ReturnType<typeof useLanguage>["t"]["profile"]["plans"]["errors"];

const IMPORT_VALUE = "__import__";

/** Switch between LeetCode's study plans and the user's imported lists, or
 *  import a new public LeetCode list. */
export function PlanPicker({ plans, current }: { plans: PlanOption[]; current: PlanOption }) {
  const { t } = useLanguage();
  const copy = t.profile.plans;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [importing, setImporting] = useState(false);

  async function send(method: "POST" | "DELETE", plan: string) {
    const res = await fetch("/api/study-plan", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    if (res.ok) startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label={copy.label}
        value={current.slug}
        disabled={pending}
        className="w-64"
        onValueChange={(value) => {
          if (value === IMPORT_VALUE) setImporting(true);
          else if (value !== current.slug) void send("POST", value);
        }}
      >
        {plans.map((plan) => (
          <option key={plan.slug} value={plan.slug}>
            {plan.name}
          </option>
        ))}
        <option value={IMPORT_VALUE}>+ {copy.importOption}</option>
      </Select>
      {current.custom && (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => void send("DELETE", current.slug)}>
          {copy.removeList}
        </Button>
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const copy = t.profile.plans;
  const mounted = useHydrated();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [link, setLink] = useState("");
  const [error, setError] = useState<ImportError | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  // Focuses the first control inside the form: the link input.
  useDialogA11y({ open: true, onClose, containerRef: dialogRef });

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!link.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/study-plan/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ link }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        const code = res.status === 429 ? "rate_limited" : body?.error;
        setError(code && code in copy.errors ? (code as ImportError) : "generic");
        return;
      }
      startRefresh(() => router.refresh());
      onClose();
    } catch {
      setError("generic");
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6" role="presentation">
      <button
        type="button"
        aria-label={copy.cancel}
        tabIndex={-1}
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <form
        ref={dialogRef}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative z-[101] w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">
            {copy.importTitle}
          </h2>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p id={descriptionId} className="text-sm leading-6 text-muted">
            {copy.importDescription}
          </p>
          <Input
            aria-label={copy.inputLabel}
            placeholder={copy.placeholder}
            value={link}
            onChange={(event) => {
              setLink(event.target.value);
              setError(null);
            }}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          <p className="text-xs text-muted">{copy.importGrouping}</p>
          {error && (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
              {copy.errors[error]}
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button onClick={onClose} disabled={busy}>
            {copy.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={busy || refreshing || !link.trim()}>
            {(busy || refreshing) && <Spinner />}
            {copy.import}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
