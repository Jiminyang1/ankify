import { notFound } from "next/navigation";
import { DifficultyPill, FsrsStatePill, Pill } from "@/components/ui/pill";
import { Surface } from "@/components/ui/surface";
import { Markdown } from "@/components/ui/markdown";
import { SubmissionList } from "@/components/submission-list";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ProblemWorkspace, type WorkspacePanel } from "./problem-workspace";
import { ProblemDetailLayout } from "./problem-detail-layout";
import { requirePageUser } from "@/server/auth";
import { getRequestLanguage, getRequestTranslations } from "@/server/i18n";
import { cn, formatRelative } from "@/lib/utils";
import { ArchiveProblemButton } from "./archive-problem-button";
import { DeleteProblemButton } from "./delete-problem-button";
import { NotesEditor } from "./notes-editor";
import { MistakeList } from "./mistake-list";
import { loadProblemDetail } from "@/server/problem-detail";

const RATING_TONES: Record<number, "danger" | "warning" | "success" | "accent" | "neutral"> = { 1: "danger", 2: "warning", 3: "success", 4: "accent" };

function currentTimeMs() {
  return Date.now();
}

function ratingLabel(rating: number | null, t: Awaited<ReturnType<typeof getRequestTranslations>>) {
  if (rating === 1) return t.rating.again;
  if (rating === 2) return t.rating.hard;
  if (rating === 3) return t.rating.good;
  if (rating === 4) return t.rating.easy;
  return rating;
}

export const dynamic = "force-dynamic";

export default async function ProblemDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const [t, language] = await Promise.all([getRequestTranslations(), getRequestLanguage()]);
  const { id } = await params;
  const detail = await loadProblemDetail(user.id, id);
  if (!detail) notFound();
  const { problem, submissions, timeline, sessions, mistakes } = detail;
  const dateFormat = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const ratingBySession = new Map(timeline.flatMap((event) => (event.kind === "rated" && event.practiceSessionId ? [[event.practiceSessionId, event.rating] as const] : [])));

  const awaitingInitial = problem.enrollment === "awaiting_initial";
  const isDue = !awaitingInitial && (!problem.fsrsDue || new Date(problem.fsrsDue).getTime() <= currentTimeMs());

  const statementPanel = problem.descriptionMd ? (
    <Markdown>{problem.descriptionMd}</Markdown>
  ) : (
    <EmptyState
      title={t.detail.noStatement}
      description={t.detail.statementHelp}
    />
  );

  const submissionsPanel =
    submissions.length === 0 ? (
      <EmptyState title={t.detail.noSubmissions} description={t.detail.submissionsHelp} />
    ) : (
      <SubmissionList submissions={submissions} problemId={problem.id} />
    );

  const historyPanel =
    timeline.length === 0 ? (
      <EmptyState title={t.detail.noReviews} description={t.detail.reviewsHelp} />
    ) : (
      <ul className="divide-y divide-border">
        {timeline.map((event) => (
          <li key={event.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
            {event.kind === "rated" ? (
              <Pill tone={RATING_TONES[event.rating!] ?? "neutral"}>{ratingLabel(event.rating, t)}</Pill>
            ) : (
              <Pill tone="accent">{t.sessions.scheduled}</Pill>
            )}
            <span className="text-muted">{formatRelative(event.occurredAt)}</span>
            {event.method && <span className="text-xs text-muted">{t.sessions.methods[event.method] ?? event.method}</span>}
            {event.nextDue && <span className="text-xs text-muted">{t.sessions.nextDue(dateFormat.format(new Date(event.nextDue)))}</span>}
            {event.stability != null && (
              <span className="ml-auto text-xs text-muted tabular-nums">
                s{event.stability.toFixed(1)} d{(event.difficulty ?? 0).toFixed(1)}
              </span>
            )}
          </li>
        ))}
      </ul>
    );

  const sessionsPanel =
    sessions.length === 0 ? (
      <EmptyState title={t.sessions.none} description={t.sessions.noneHelp} />
    ) : (
      <ul className="divide-y divide-border">
        {sessions.map((session) => {
          const state = session.status === "completed" ? (session.outcome ?? "unknown") : session.status;
          const rating = ratingBySession.get(session.id);
          return (
            <li key={session.id} className="space-y-2 py-3 text-sm first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t.dashboard.kinds[session.type] ?? session.type}</span>
                <Pill tone={state === "accepted" ? "success" : state === "failed" ? "danger" : "neutral"}>{t.dashboard.states[state] ?? state}</Pill>
                {rating != null && <Pill tone={RATING_TONES[rating] ?? "neutral"}>{t.sessions.ratedAs(String(ratingLabel(rating, t)))}</Pill>}
                <span className="ml-auto text-xs text-muted">{formatRelative(session.timing.startedAt)}</span>
              </div>
              <p className="text-xs text-muted">
                {t.sessions.evidence(session.evidence.submissions, session.evidence.accepted)} · {t.sessions.activeMinutes(Math.round(session.timing.activeMs / 60_000))}
              </p>
            </li>
          );
        })}
      </ul>
    );

  const notesPanel = <NotesEditor problemId={problem.id} initialNotes={problem.notes ?? ""} />;

  const mistakesPanel = <MistakeList problemId={problem.id} initialMistakes={mistakes} />;

  const panels: WorkspacePanel[] = [
    { id: "statement", label: t.detail.statement, node: statementPanel },
    { id: "submissions", label: t.review.submissions, count: submissions.length, node: submissionsPanel },
    { id: "mistakes", label: t.mistakes.tab, count: mistakes.length, node: mistakesPanel },
    { id: "sessions", label: t.sessions.tab, count: sessions.length, node: sessionsPanel },
    { id: "history", label: t.detail.history, count: timeline.length, node: historyPanel },
    { id: "notes", label: t.review.notes, node: notesPanel },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <ProblemDetailLayout
        rail={
          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Surface className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <DifficultyPill difficulty={problem.difficulty} language={language} />
              <FsrsStatePill state={problem.fsrsState} language={language} />
              {problem.archivedAt != null && <Pill tone="neutral">{t.detail.archived}</Pill>}
              {problem.archivedAt == null && isDue && problem.fsrsReps > 0 && <Pill tone="accent">{t.common.due}</Pill>}
            </div>
            <h1 className="mt-3 text-xl font-semibold leading-snug tracking-tight">
              {problem.leetcodeId != null && (
                <span className="text-muted tabular-nums">{problem.leetcodeId}. </span>
              )}
              {problem.title}
            </h1>
            {problem.topicTags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted">
                {problem.topicTags.slice(0, 6).map((t) => (
                  <span key={t}>#{t}</span>
                ))}
              </div>
            )}
            <a
              href={problem.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-sm text-muted hover:text-accent"
            >
              {t.detail.openLeetcode} <span aria-hidden>↗</span>
            </a>
          </Surface>

          <Surface className="overflow-hidden">
            <div className="border-b border-border px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted">
              {t.detail.scheduling}
            </div>
            <dl className="divide-y divide-border">
              <MetaRow
                label={t.detail.due}
                value={awaitingInitial ? t.common.notScheduled : isDue ? t.common.now : formatRelative(problem.fsrsDue)}
                accent={isDue}
              />
              <MetaRow
                label={t.detail.reviews}
                value={
                  <>
                    {problem.fsrsReps}
                    {problem.fsrsLapses > 0 && (
                      <span className="ml-1.5 text-xs font-normal text-danger">
                        {t.common.lapses(problem.fsrsLapses)}
                      </span>
                    )}
                  </>
                }
              />
              <MetaRow
                label={t.sessions.nextReview}
                value={!awaitingInitial && problem.fsrsDue ? dateFormat.format(new Date(problem.fsrsDue)) : "—"}
              />
              <MetaRow label={t.detail.lastReviewed} value={formatRelative(problem.fsrsLastReview)} />
            </dl>
          </Surface>

          {problem.archivedAt != null && (
            <p className="rounded-lg border border-border bg-subtle px-3 py-2 text-xs text-muted">
              {t.detail.archivedNotice}
            </p>
          )}

          <div className="space-y-2">
            {problem.archivedAt == null && (
              <a href={problem.url} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "primary", className: "w-full" })}>
                {t.detail.practiceOnLeetcode}
              </a>
            )}
            <div className="flex flex-wrap gap-2">
              <ArchiveProblemButton problemId={problem.id} archived={problem.archivedAt != null} />
              <DeleteProblemButton problemId={problem.id} problemTitle={problem.title} />
            </div>
          </div>
          </aside>
        }
        workspace={
          <ProblemWorkspace
            defaultTab="statement"
            panels={panels}
          />
        }
      />
    </div>
  );
}

function MetaRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("font-medium tabular-nums", accent && "text-accent")}>{value}</dd>
    </div>
  );
}
