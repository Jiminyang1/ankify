import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { getDb, schema } from "@ankify/db";
import { and, desc, eq } from "drizzle-orm";
import { DifficultyPill, FsrsStatePill, Pill } from "@/components/ui/pill";
import { Surface } from "@/components/ui/surface";
import { Markdown } from "@/components/ui/markdown";
import { formatAbsolute, formatRelative } from "@/lib/utils";
import { UserCardButton } from "./user-card-button";
import { CardList } from "./card-list";

const RATING_LABELS: Record<number, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
const RATING_TONES: Record<number, "danger" | "warning" | "success" | "accent" | "neutral"> = { 1: "danger", 2: "warning", 3: "success", 4: "accent" };

export const dynamic = "force-dynamic";

export default async function ProblemDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const problemRows = await db.select().from(schema.problems).where(eq(schema.problems.id, id));
  const problem = problemRows[0];
  if (!problem) notFound();

  const submissions = await db
    .select()
    .from(schema.submissions)
    .where(eq(schema.submissions.problemId, id))
    .orderBy(desc(schema.submissions.submittedAt));

  const cards = await db
    .select()
    .from(schema.cards)
    .where(and(eq(schema.cards.problemId, id), eq(schema.cards.aiStatus, "ready")))
    .orderBy(desc(schema.cards.createdAt));

  const reviewHistory = await db
    .select()
    .from(schema.reviewEvents)
    .where(and(eq(schema.reviewEvents.problemId, id), eq(schema.reviewEvents.eventType, "self_recall_rated")))
    .orderBy(desc(schema.reviewEvents.occurredAt))
    .limit(20);

  const isDue = !problem.fsrsDue || new Date(problem.fsrsDue).getTime() <= Date.now();

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <DifficultyPill difficulty={problem.difficulty} />
            <FsrsStatePill state={problem.fsrsState} />
            {isDue && problem.fsrsReps > 0 && <Pill tone="accent">due</Pill>}
            {problem.topicTags.slice(0, 4).map((t) => (
              <span key={t} className="text-xs text-muted">
                #{t}
              </span>
            ))}
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">{problem.title}</h1>
          <a
            href={problem.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-sm text-muted hover:text-accent"
          >
            Open on LeetCode <span aria-hidden>↗</span>
          </a>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(isDue || problem.fsrsReps === 0) && (
            <Link
              href="/review"
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-card hover:opacity-90"
            >
              Review now
              <span aria-hidden>→</span>
            </Link>
          )}
          <Link
            href={"/analysis" as Route}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-subtle"
          >
            Analysis
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FsrsStat label="Due" value={isDue ? "now" : formatRelative(problem.fsrsDue)} accent={isDue} />
        <FsrsStat label="Reviews" value={
          <>
            {problem.fsrsReps}
            {problem.fsrsLapses > 0 && <span className="text-danger"> · {problem.fsrsLapses}↓</span>}
          </>
        } hint="reps · lapses" />
        <FsrsStat label="Last reviewed" value={formatRelative(problem.fsrsLastReview)} />
        <FsrsStat label="Cards" value={cards.length} hint={cards.length === 0 ? undefined : "Saved"} />
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Cards</h2>
            <p className="mt-1 text-xs text-muted">
              {cards.length === 0
                ? "Capture your thoughts: confusions, lessons, edge cases you want to remember."
                : `${cards.length} saved card${cards.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <UserCardButton
              problemId={problem.id}
              problemTitle={problem.title}
              problemDescription={problem.descriptionMd}
            />
          </div>
        </div>

        {cards.length === 0 ? (
          <Surface className="mt-4 p-8 text-center">
            <p className="text-sm text-muted">
              No cards yet. Click <span className="font-medium">+ My card</span> to write down what just confused you, and AI will structure it.
            </p>
          </Surface>
        ) : (
          <CardList cards={cards} problemId={problem.id} />
        )}
      </section>

      {/* Submissions */}
      <section>
        {submissions.length === 0 ? (
          <>
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Submissions</h2>
              <span className="text-xs text-muted">0 captured</span>
            </div>
            <p className="mt-3 text-sm text-muted">No submissions yet.</p>
          </>
        ) : (
          <details className="group rounded-xl border border-border bg-surface shadow-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
              <div>
                <h2 className="text-lg font-semibold">Submissions</h2>
                <p className="mt-0.5 text-xs text-muted">
                  {submissions.length} captured · latest {formatAbsolute(submissions[0]!.submittedAt)}
                </p>
              </div>
              <span className="text-xs font-medium text-accent group-open:hidden">Expand</span>
              <span className="hidden text-xs font-medium text-muted group-open:inline">Collapse</span>
            </summary>
            <ul className="space-y-3 border-t border-border p-4">
              {submissions.map((s) => {
                const passed = s.status === "Accepted";
                return (
                  <li key={s.id}>
                    <Surface className="overflow-hidden">
                      <div className="flex items-center justify-between gap-2 border-b border-border bg-subtle/50 px-4 py-2 text-xs">
                        <div className="flex items-center gap-3">
                          <Pill tone={passed ? "success" : "danger"}>{s.status}</Pill>
                          <span className="font-mono text-muted">{s.language}</span>
                          {s.runtimeMs != null && <span className="text-muted">{s.runtimeMs} ms</span>}
                          {s.memoryKb != null && <span className="text-muted">{(s.memoryKb / 1024).toFixed(1)} MB</span>}
                        </div>
                        <span className="text-muted">{formatAbsolute(s.submittedAt)}</span>
                      </div>
                      {s.errorMessage && (
                        <div className="border-b border-border bg-danger/5 px-4 py-2 text-xs text-danger">
                          {s.errorMessage}
                        </div>
                      )}
                      <pre className="max-h-64 overflow-auto px-4 py-3 font-mono text-xs leading-relaxed">
                        {s.code}
                      </pre>
                    </Surface>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </section>

      {/* Problem statement */}
      {problem.descriptionMd && (
        <section>
          <h2 className="text-lg font-semibold">Problem statement</h2>
          <Surface className="mt-3 p-5">
            <Markdown>{problem.descriptionMd}</Markdown>
          </Surface>
        </section>
      )}

      {/* Review history */}
      {reviewHistory.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Review history</h2>
          <div className="mt-3 space-y-1.5">
            {reviewHistory.map((ev) => (
              <div key={ev.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm">
                <Pill tone={RATING_TONES[ev.fsrsRating!] ?? "neutral"}>{RATING_LABELS[ev.fsrsRating!] ?? ev.fsrsRating}</Pill>
                <span className="text-muted">{formatRelative(ev.occurredAt)}</span>
                {ev.fsrsStabilitySnap != null && (
                  <span className="font-mono text-xs text-muted">
                    s{(ev.fsrsStabilitySnap).toFixed(1)} d{(ev.fsrsDifficultySnap ?? 0).toFixed(1)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Notes */}
      {problem.notes && (
        <section>
          <h2 className="text-lg font-semibold">Your notes</h2>
          <Surface className="mt-3 p-5">
            <Markdown>{problem.notes}</Markdown>
          </Surface>
        </section>
      )}
    </div>
  );
}

function FsrsStat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        "rounded-lg border border-border bg-surface p-3 " +
        (accent ? "border-accent/30 bg-accent-soft/40" : "")
      }
    >
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={"mt-0.5 text-lg font-semibold tabular-nums " + (accent ? "text-accent" : "")}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-muted">{hint}</div>}
    </div>
  );
}
