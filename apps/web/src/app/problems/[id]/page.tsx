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
import { cn, formatRelative } from "@/lib/utils";
import { UserCardButton } from "./user-card-button";
import { CardList } from "./card-list";
import { DeleteProblemButton } from "./delete-problem-button";
import { NotesEditor } from "./notes-editor";

const RATING_LABELS: Record<number, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
const RATING_TONES: Record<number, "danger" | "warning" | "success" | "accent" | "neutral"> = { 1: "danger", 2: "warning", 3: "success", 4: "accent" };

export const dynamic = "force-dynamic";

export default async function ProblemDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
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
      title="No statement captured"
      description="The problem statement is pulled in when you capture from LeetCode."
    />
  );

  const cardsPanel =
    cards.length === 0 ? (
      <EmptyState
        title="No cards yet"
        description="Capture what confused you on this problem — write it yourself, or let AI structure a draft into a flashcard."
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
            {cards.length} saved card{cards.length === 1 ? "" : "s"}
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
      <EmptyState title="No submissions yet" description="Submissions captured from LeetCode will appear here." />
    ) : (
      <SubmissionList submissions={submissions} />
    );

  const historyPanel =
    reviewHistory.length === 0 ? (
      <EmptyState title="No reviews yet" description="Your recall ratings show up here once you start reviewing." />
    ) : (
      <ul className="divide-y divide-border">
        {reviewHistory.map((ev) => (
          <li key={ev.id} className="flex items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
            <Pill tone={RATING_TONES[ev.fsrsRating!] ?? "neutral"}>{RATING_LABELS[ev.fsrsRating!] ?? ev.fsrsRating}</Pill>
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
    { id: "statement", label: "Statement", node: statementPanel },
    { id: "cards", label: "Cards", count: cards.length, node: cardsPanel },
    { id: "submissions", label: "Submissions", count: submissions.length, node: submissionsPanel },
    { id: "history", label: "History", count: reviewHistory.length, node: historyPanel },
    { id: "notes", label: "Notes", node: notesPanel },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* Identity + scheduling — the "what am I managing" rail */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Surface className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <DifficultyPill difficulty={problem.difficulty} />
              <FsrsStatePill state={problem.fsrsState} />
              {isDue && problem.fsrsReps > 0 && <Pill tone="accent">due</Pill>}
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
              Open on LeetCode <span aria-hidden>↗</span>
            </a>
          </Surface>

          <Surface className="overflow-hidden">
            <div className="border-b border-border px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted">
              Scheduling
            </div>
            <dl className="divide-y divide-border">
              <MetaRow label="Due" value={isDue ? "now" : formatRelative(problem.fsrsDue)} accent={isDue} />
              <MetaRow
                label="Reviews"
                value={
                  <>
                    {problem.fsrsReps}
                    {problem.fsrsLapses > 0 && (
                      <span className="ml-1.5 text-xs font-normal text-danger">
                        {problem.fsrsLapses} lapse{problem.fsrsLapses === 1 ? "" : "s"}
                      </span>
                    )}
                  </>
                }
              />
              <MetaRow label="Last reviewed" value={formatRelative(problem.fsrsLastReview)} />
              <MetaRow label="Cards" value={cards.length} />
            </dl>
          </Surface>

          <div className="flex gap-2">
            <Link
              href={`/review?problemId=${problem.id}`}
              className={buttonClasses({ variant: "primary", className: "flex-1" })}
            >
              {isDue || problem.fsrsReps === 0 ? "Review" : "Review ahead"}
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
