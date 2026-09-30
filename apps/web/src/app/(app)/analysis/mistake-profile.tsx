import Link from "next/link";
import type { Route } from "next";
import type { MistakeProfileDto } from "@ankify/contracts";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill } from "@/components/ui/pill";
import { Surface } from "@/components/ui/surface";
import type { Translation } from "@/lib/i18n";
import { CandidateActions } from "./candidate-actions";

/**
 * The mistake profile (GET /api/mistakes/profile, computed on read): confirmed
 * patterns, unconfirmed AI suggestions apart from them, and session signals.
 * Nothing here is inferred beyond what the profile reports.
 */
export function MistakeProfileSection({ profile, t }: { profile: MistakeProfileDto; t: Translation }) {
  const p = t.profile;
  const category = (id: string) => t.mistakes.categories[id as keyof typeof t.mistakes.categories] ?? id;
  const categories = profile.categories.filter((item) => item.contexts > 0);
  const topics = [...profile.topics].sort((a, b) => b.sessions - a.sessions || a.topic.localeCompare(b.topic)).slice(0, 10);
  const { sessions, ratings } = profile.signals;
  return (
    <section aria-label={p.title} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{p.title}</h2>
        <p className="mt-1 text-sm text-muted">{p.subtitle(profile.windowDays)}</p>
      </div>

      {!profile.readiness.personalized && (
        <p className="rounded-xl border border-border bg-subtle px-4 py-3 text-sm">
          {p.notReady(profile.readiness.completedSessions, profile.readiness.required.sessions, profile.readiness.distinctProblems, profile.readiness.required.problems)}
        </p>
      )}

      <Surface as="section" aria-label={p.recorded} className="p-5">
        <h3 className="text-base font-semibold">{p.recorded}</h3>
        {categories.length === 0 ? (
          <EmptyState title={p.noneRecorded} description={p.noneRecordedHelp} />
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {categories.map((item) => (
              <li key={item.category} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{category(item.category)}</span>
                  {item.weak && <Pill tone={item.ready ? "warning" : "neutral"}>{item.ready ? p.recurring : p.emerging}</Pill>}
                  <span className="ml-auto text-sm tabular-nums text-muted">{p.contexts(item.contexts, item.problems)}</span>
                </div>
                <p className="text-sm text-muted">
                  {p.detail(item.unresolved, item.resolved, item.improvements)} · {p.trend(item.trend.current, item.trend.previous, item.trend.periodDays)}
                </p>
                {item.examples.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {item.examples.map((example) => (
                      <li key={example.mistakeId}>
                        <Link href={`/problems/${example.problemId}` as Route} className="text-accent hover:underline">
                          {example.problemTitle}
                        </Link>
                        {example.summary && <span className="text-muted">: {example.summary}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Surface>

      {profile.candidates.length > 0 && (
        <Surface as="section" aria-label={p.candidates} className="p-5">
          <h3 className="text-base font-semibold">{p.candidates}</h3>
          <p className="mt-1 text-sm text-muted">{p.candidatesHelp}</p>
          <ul className="mt-3 divide-y divide-border">
            {profile.candidates.map((candidate) => (
              <li key={candidate.mistakeId} className="flex flex-wrap items-center gap-3 py-3">
                <Pill tone="accent">{category(candidate.category)}</Pill>
                <div className="min-w-0 flex-1 text-sm">
                  <Link href={`/problems/${candidate.problemId}` as Route} className="font-medium text-accent hover:underline">
                    {candidate.problemTitle}
                  </Link>
                  {candidate.summary && <p className="text-muted">{candidate.summary}</p>}
                </div>
                <CandidateActions mistakeId={candidate.mistakeId} />
              </li>
            ))}
          </ul>
        </Surface>
      )}

      <Surface as="section" aria-label={p.signals} className="p-5">
        <h3 className="text-base font-semibold">{p.signals}</h3>
        <p className="mt-1 text-sm text-muted">
          {p.sessionSignals(sessions.completed, sessions.accepted, sessions.failed)} · {p.ratingSignals(ratings.again, ratings.hard, ratings.good, ratings.easy)}
        </p>
        {topics.length > 0 && (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-2 font-medium">{p.topic}</th>
                <th className="py-2 text-right font-medium">{p.sessionsColumn}</th>
                <th className="py-2 text-right font-medium">{p.acceptedColumn}</th>
                <th className="py-2 text-right font-medium">{p.firstTryColumn}</th>
                <th className="py-2 text-right font-medium">{p.medianColumn}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {topics.map((topic) => (
                <tr key={topic.topic}>
                  <td className="py-2">{topic.topic}</td>
                  <td className="py-2 text-right tabular-nums">{topic.sessions}</td>
                  <td className="py-2 text-right tabular-nums">{topic.accepted}</td>
                  <td className="py-2 text-right tabular-nums">{topic.firstTryAccepted}</td>
                  <td className="py-2 text-right tabular-nums">{topic.medianFailedBeforeAccepted ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {(profile.incomplete.sessionsWithPartialCapture > 0 || profile.incomplete.ambiguousObservations > 0) && (
          <p className="mt-3 text-xs text-muted">{p.incomplete(profile.incomplete.sessionsWithPartialCapture, profile.incomplete.ambiguousObservations)}</p>
        )}
      </Surface>
    </section>
  );
}
