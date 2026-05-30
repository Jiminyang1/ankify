import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, schema } from "@ankify/db";
import { and, desc, eq } from "drizzle-orm";
import { DifficultyPill, FsrsStatePill, Pill } from "@/components/ui/pill";
import { Surface } from "@/components/ui/surface";
import { Markdown } from "@/components/ui/markdown";
import { SubmissionList } from "@/components/submission-list";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ProblemWorkspace, type WorkspacePanel } from "./problem-workspace";
import { requirePageUser } from "@/lib/auth";
import { getRequestLanguage, getRequestTranslations } from "@/lib/i18n-server";
import { cn, formatRelative } from "@/lib/utils";
import { UserCardButton } from "./user-card-button";
import { CardList } from "./card-list";
import { DeleteProblemButton } from "./delete-problem-button";
import { NotesEditor } from "./notes-editor";

const RATING_TONES: Record<number, "danger" | "warning" | "success" | "accent" | "neutral"> = { 1: "danger", 2: "warning", 3: "success", 4: "accent" };

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
  const db = getDb();
  const problemRows = await db
    .select()
    .from(schema.problems)
    .where(and(eq(schema.problems.id, id), eq(schema.problems.userId, user.id)));
  const problem = problemRows[0];
  if (!problem) notFound();

  const [submissions, cards, reviewHistory] = await Promise.all([
    db
      .select()
      .from(schema.submissions)
      .where(and(eq(schema.submissions.userId, user.id), eq(schema.submissions.problemId, id)))
      .orderBy(desc(schema.submissions.submittedAt)),
    db
      .select()
      .from(schema.cards)
      .where(and(eq(schema.cards.userId, user.id), eq(schema.cards.problemId, id), eq(schema.cards.aiStatus, "ready")))
      .orderBy(desc(schema.cards.createdAt)),
    db
      .select()
      .from(schema.reviewEvents)
      .where(and(eq(schema.reviewEvents.userId, user.id), eq(schema.reviewEvents.problemId, id), eq(schema.reviewEvents.eventType, "self_recall_rated")))
      .orderBy(desc(schema.reviewEvents.occurredAt))
      .limit(20),
  ]);

  const isDue = !problem.fsrsDue || new Date(problem.fsrsDue).getTime() <= Date.now();

  const statementPanel = problem.descriptionMd ? (
    <Markdown>{problem.descriptionMd}</Markdown>
  ) : (
    <EmptyState
      title={t.detail.noStatement}
      description={t.detail.statementHelp}
    />
  );

  const cardsPanel =
    cards.length === 0 ? (
      <EmptyState
        title={t.detail.noCards}
        description={t.detail.cardsHelp}
        action={
          <UserCardButton
            problemId={problem.id}
            problemTitle={problem.title}
            problemDescription={problem.descriptionMd}
          />
        }
      />
    ) : (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {t.detail.savedCards(cards.length)}
          </p>
          <UserCardButton
            problemId={problem.id}
            problemTitle={problem.title}
            problemDescription={problem.descriptionMd}
          />
        </div>
        <CardList cards={cards} />
      </div>
    );

  const submissionsPanel =
    submissions.length === 0 ? (
      <EmptyState title={t.detail.noSubmissions} description={t.detail.submissionsHelp} />
    ) : (
      <SubmissionList submissions={submissions} />
    );

  const historyPanel =
    reviewHistory.length === 0 ? (
      <EmptyState title={t.detail.noReviews} description={t.detail.reviewsHelp} />
    ) : (
      <ul className="divide-y divide-border">
        {reviewHistory.map((ev) => (
          <li key={ev.id} className="flex items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
            <Pill tone={RATING_TONES[ev.fsrsRating!] ?? "neutral"}>{ratingLabel(ev.fsrsRating, t)}</Pill>
            <span className="text-muted">{formatRelative(ev.occurredAt)}</span>
            {ev.fsrsStabilitySnap != null && (
              <span className="text-xs text-muted tabular-nums">
                s{ev.fsrsStabilitySnap.toFixed(1)} d{(ev.fsrsDifficultySnap ?? 0).toFixed(1)}
              </span>
            )}
          </li>
        ))}
      </ul>
    );

  const notesPanel = <NotesEditor problemId={problem.id} initialNotes={problem.notes ?? ""} />;

  const panels: WorkspacePanel[] = [
    { id: "statement", label: t.detail.statement, node: statementPanel },
    { id: "cards", label: t.review.cards, count: cards.length, node: cardsPanel },
    { id: "submissions", label: t.review.submissions, count: submissions.length, node: submissionsPanel },
    { id: "history", label: t.detail.history, count: reviewHistory.length, node: historyPanel },
    { id: "notes", label: t.review.notes, node: notesPanel },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* Identity + scheduling — the "what am I managing" rail */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Surface className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <DifficultyPill difficulty={problem.difficulty} language={language} />
              <FsrsStatePill state={problem.fsrsState} language={language} />
              {isDue && problem.fsrsReps > 0 && <Pill tone="accent">{t.common.due}</Pill>}
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
              <MetaRow label={t.detail.due} value={isDue ? t.common.now : formatRelative(problem.fsrsDue)} accent={isDue} />
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
              <MetaRow label={t.detail.lastReviewed} value={formatRelative(problem.fsrsLastReview)} />
              <MetaRow label={t.review.cards} value={cards.length} />
            </dl>
          </Surface>

          <div className="flex gap-2">
            <Link
              href={`/review?problemId=${problem.id}`}
              className={buttonClasses({ variant: "primary", className: "flex-1" })}
            >
              {isDue || problem.fsrsReps === 0 ? t.nav.review : t.detail.reviewAhead}
            </Link>
            <DeleteProblemButton problemId={problem.id} problemTitle={problem.title} />
          </div>
        </aside>

        {/* Content workspace — one panel at a time, like a console */}
        <ProblemWorkspace defaultTab="statement" panels={panels} />
      </div>
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
