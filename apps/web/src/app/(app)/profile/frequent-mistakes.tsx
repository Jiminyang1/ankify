"use client";

import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import { Surface } from "@/components/ui/surface";
import { weaknessCategoryName } from "@/lib/weakness-names";
import type { FrequentMistake } from "@/server/profile";

/** The kinds of mistakes the user keeps making, across problems, with the
 *  problems behind each (and the chapter each one sits in). Each chapter's
 *  own weak spots are in its dialog. */
export function FrequentMistakes({ mistakes }: { mistakes: FrequentMistake[] }) {
  const { language, t } = useLanguage();
  const copy = t.profile.mistakes;
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-lg font-semibold">{copy.title}</h2>
        <p className="mt-1 text-sm text-muted">{copy.description}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {mistakes.map((entry) => (
          <Surface key={entry.category} className="p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold">
                {weaknessCategoryName(entry.category, entry.categoryName, language)}
              </h3>
              <span className="shrink-0 text-xs text-muted tabular-nums">
                <span className="font-medium text-warning">{copy.active(entry.active)}</span>
                {entry.hits > entry.active && <> · {copy.timesSeen(entry.hits)}</>}
              </span>
            </div>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {entry.problems.map((problem) => (
                <li key={problem.id}>
                  <Link
                    href={`/problems/${problem.id}`}
                    title={problem.chapter ?? copy.outsidePlan}
                    className="inline-flex max-w-full items-baseline gap-1.5 rounded-md border border-border bg-subtle px-2 py-0.5 text-xs text-fg transition hover:border-accent/40"
                  >
                    <span className="truncate">{problem.title}</span>
                    {problem.chapter && <span className="shrink-0 text-[11px] text-muted">{problem.chapter}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </Surface>
        ))}
      </div>
    </section>
  );
}
