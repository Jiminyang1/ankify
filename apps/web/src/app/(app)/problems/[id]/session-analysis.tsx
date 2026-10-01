"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { MistakeRecordDto, SessionAnalysisFinding, SessionAnalysisStateDto } from "@ankify/contracts";
import { useLanguage } from "@/components/LanguageProvider";
import { CandidateActions } from "@/components/mistakes/candidate-actions";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Spinner } from "@/components/ui/spinner";

const POLL_MS = 4_000;
const POLL_LIMIT_MS = 5 * 60_000;

/**
 * One completed session's analysis on the problem page: its state (queued,
 * analyzing, done, failed, unavailable), its findings with confirm / correct /
 * dismiss, and Analyze for sessions without a current analysis. It loads when
 * it first scrolls into view (the Sessions tab can list twenty sessions).
 */
export function SessionAnalysis({ sessionId }: { sessionId: string }) {
  const { t } = useLanguage();
  const f = t.findings;
  const root = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<SessionAnalysisStateDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollUntil = useRef<number | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/practice-sessions/${encodeURIComponent(sessionId)}/analysis`, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return null;
    const next = (await response.json()) as SessionAnalysisStateDto;
    setState(next);
    return next;
  }, [sessionId]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        void load();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [load]);

  // While a job is queued or running, check again; the result appears without a reload.
  const running = state?.job?.status === "queued" || state?.job?.status === "running";
  useEffect(() => {
    if (!running) {
      pollUntil.current = null;
      return;
    }
    pollUntil.current ??= Date.now() + POLL_LIMIT_MS;
    if (Date.now() > pollUntil.current) return;
    const timer = window.setTimeout(() => void load(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [running, state, load]);

  async function analyze() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/ai-jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "session_analyze", practiceSessionId: sessionId, requestId: crypto.randomUUID() }),
    }).catch(() => null);
    if (!response?.ok) {
      const code = ((await response?.json().catch(() => null)) as { error?: string } | null)?.error;
      setError(f.errors[code ?? ""] ?? f.failed);
    }
    await load();
    setBusy(false);
  }

  if (!state) return <div ref={root} className="h-px" />;
  const reason = state.manual.available ? null : state.manual.reason;
  if (!state.analysis && !state.job && (reason === "disabled" || reason === "session_not_completed")) return <div ref={root} />;

  const recordOf = (finding: SessionAnalysisFinding) => state.findings.find((record) => record.id === finding.mistakeId);
  const analyzeButton = (label: string) => (
    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void analyze()}>
      {busy && <Spinner />}
      {label}
    </Button>
  );

  return (
    <div ref={root} role="group" aria-label={f.title} className="space-y-2 rounded-lg border border-border bg-subtle/40 p-3 text-sm">
      <p className="text-xs font-medium text-muted">{f.title}</p>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {running ? (
        <p role="status" className="inline-flex items-center gap-2 text-muted">
          <Spinner />
          {state.job?.status === "queued" ? f.queued : f.running}
        </p>
      ) : state.analysis ? (
        <>
          {state.analysis.stale && <p className="text-xs text-warning">{f.stale}</p>}
          <p>{state.analysis.result.summary}</p>
          {state.analysis.result.findings.length === 0 ? (
            <p className="text-muted">{state.analysis.result.insufficientEvidence ? f.insufficient : f.noFinding}</p>
          ) : (
            <ul className="space-y-2">
              {state.analysis.result.findings.map((finding) => (
                <Finding key={finding.category} finding={finding} record={recordOf(finding)} onDecided={() => void load()} />
              ))}
            </ul>
          )}
        </>
      ) : state.job?.status === "failed" ? (
        <p className="text-danger">{f.errors[state.job.errorCode ?? ""] ?? f.failed}</p>
      ) : null}

      {!running && state.manual.available && (!state.analysis || state.analysis.stale) &&
        analyzeButton(state.analysis ? f.analyzeAgain : state.job?.status === "failed" ? f.retry : f.analyze)}
      {!running && !state.analysis && reason === "own_key_required" && (
        <p className="text-xs text-muted">
          {f.needsKey}{" "}
          <Link href="/settings" className="text-accent hover:underline">
            {f.openSettings}
          </Link>
        </p>
      )}
      {!running && !state.analysis && reason === "insufficient_evidence" && <p className="text-xs text-muted">{f.noCode}</p>}
    </div>
  );
}

function Finding({ finding, record, onDecided }: { finding: SessionAnalysisFinding; record: MistakeRecordDto | undefined; onDecided: () => void }) {
  const { t } = useLanguage();
  const f = t.findings;
  const category = record?.primaryCategory ?? finding.category;
  return (
    <li className="space-y-1.5 rounded-md bg-surface p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="accent">{t.mistakes.categories[category]}</Pill>
        {record?.status === "confirmed" && <Pill tone="success">{f.confirmed}</Pill>}
        {record?.status === "dismissed" && <Pill>{f.dismissed}</Pill>}
        {record && record.suggestedCategory && record.suggestedCategory !== record.primaryCategory && (
          <span className="text-xs text-muted">{f.correctedFrom(t.mistakes.categories[record.suggestedCategory])}</span>
        )}
      </div>
      <p>{finding.cause}</p>
      {finding.nextStep && <p className="text-muted">{f.nextStep(finding.nextStep)}</p>}
      {record?.status === "candidate" && <CandidateActions mistakeId={record.id} category={record.primaryCategory} onDecided={onDecided} />}
    </li>
  );
}
