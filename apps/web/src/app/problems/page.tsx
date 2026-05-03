"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Problem } from "@ankify/db";
import type { LeetCodeDifficulty } from "@ankify/core";
import { DifficultyPill, FsrsStatePill, Pill } from "@/components/ui/pill";
import { Surface } from "@/components/ui/surface";
import { cn, formatRelative } from "@/lib/utils";

type ProblemWithCards = Problem & { cardTotal: number };

type FilterState = {
  difficulty: LeetCodeDifficulty | "all";
  state: "all" | "new" | "learning" | "review" | "relearning" | "due" | "not-due";
  tag: string;
  search: string;
};

const DIFFICULTY_OPTIONS: { value: FilterState["difficulty"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "Easy", label: "Easy" },
  { value: "Medium", label: "Medium" },
  { value: "Hard", label: "Hard" },
];

const STATE_OPTIONS: { value: FilterState["state"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "due", label: "Due" },
  { value: "new", label: "New" },
  { value: "learning", label: "Learning" },
  { value: "review", label: "Review" },
  { value: "relearning", label: "Relearning" },
];

type SortKey = "title" | "due" | "difficulty" | "reps" | "drills";

export default function ProblemsPage() {
  const [problems, setProblems] = useState<ProblemWithCards[]>([]);
  const [filters, setFilters] = useState<FilterState>({ difficulty: "all", state: "all", tag: "", search: "" });
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "due", asc: true });
  const [dueCount, setDueCount] = useState(0);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/problems", { cache: "no-store" });
      const json = await res.json();
      setProblems(json.problems ?? []);
      setDueCount(json.dueCount ?? 0);
    })();
  }, []);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    problems.forEach((p) => p.topicTags.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [problems]);

  const filtered = useMemo(() => {
    let list = [...problems];

    if (filters.difficulty !== "all") {
      list = list.filter((p) => p.difficulty === filters.difficulty);
    }

    switch (filters.state) {
      case "due":
        list = list.filter((p) => !p.fsrsDue || new Date(p.fsrsDue).valueOf() <= Date.now());
        break;
      case "not-due":
        list = list.filter((p) => p.fsrsDue && new Date(p.fsrsDue).valueOf() > Date.now());
        break;
      default:
        if (filters.state !== "all") {
          list = list.filter((p) => p.fsrsState === filters.state);
        }
    }

    if (filters.tag) {
      list = list.filter((p) => p.topicTags.includes(filters.tag));
    }

    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter((p) => p.title.toLowerCase().includes(q));
    }

    const diffOrder = { Easy: 1, Medium: 2, Hard: 3 };
    list.sort((a, b) => {
      const asc = sort.asc ? 1 : -1;
      switch (sort.key) {
        case "title":
          return asc * a.title.localeCompare(b.title);
        case "due":
          return asc * ((a.fsrsDue ? new Date(a.fsrsDue).valueOf() : 0) - (b.fsrsDue ? new Date(b.fsrsDue).valueOf() : 0));
        case "difficulty":
          return asc * ((diffOrder[a.difficulty] ?? 2) - (diffOrder[b.difficulty] ?? 2));
        case "reps":
          return asc * (a.fsrsReps - b.fsrsReps);
        case "drills":
          return asc * (a.cardTotal - b.cardTotal);
        default:
          return 0;
      }
    });

    return list;
  }, [problems, filters, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) => (prev.key === key ? { key, asc: !prev.asc } : { key, asc: true }));
  };

  if (!problems.length) {
    return (
      <Surface className="p-10 text-center">
        <h1 className="text-2xl font-semibold">Problems</h1>
        <Pill tone="accent" className="mt-3">empty</Pill>
        <p className="mt-3 text-lg font-medium">No problems yet.</p>
        <p className="mt-1 text-sm text-muted">
          Use the Chrome extension on a LeetCode problem to add your first one.
        </p>
      </Surface>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Problems</h1>
        <p className="mt-1 text-sm text-muted">
          {filtered.length} of {problems.length} · <span className="text-accent">{dueCount} due</span>
        </p>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Difficulty tabs */}
        <div className="flex rounded-lg border border-border bg-subtle p-0.5">
          {DIFFICULTY_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setFilters((f) => ({ ...f, difficulty: o.value }))}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition",
                filters.difficulty === o.value ? "bg-surface shadow-sm" : "text-muted hover:text-fg",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* State filter */}
        <select
          value={filters.state}
          onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value as FilterState["state"] }))}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg focus:outline-none focus:ring-2 focus:ring-accent/40"
        >
          {STATE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* Tag filter */}
        <select
          value={filters.tag}
          onChange={(e) => setFilters((f) => ({ ...f, tag: e.target.value }))}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg focus:outline-none focus:ring-2 focus:ring-accent/40"
        >
          <option value="">All tags</option>
          {allTags.map((tag) => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>

        {/* Search */}
        <input
          type="text"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          placeholder="Search..."
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-fg placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
      </div>

      {/* Table */}
      <Surface className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                {([
                  { key: "title", label: "Title", className: "" },
                  { key: "difficulty", label: "Diff", className: "hidden sm:table-cell" },
                  { key: "due", label: "Due", className: "" },
                  { key: "reps", label: "Reps", className: "hidden md:table-cell" },
                  { key: "drills", label: "Drills", className: "hidden md:table-cell" },
                  { key: "state", label: "State", className: "hidden sm:table-cell" },
                ] as { key: SortKey | "state"; label: string; className: string }[]).map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      "px-4 py-2.5 font-medium",
                      col.className,
                      col.key !== "state" && "cursor-pointer hover:text-fg select-none",
                    )}
                    onClick={col.key !== "state" ? () => toggleSort(col.key as SortKey) : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {sort.key === col.key && (
                        <span className="text-[9px]">{sort.asc ? "▲" : "▼"}</span>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const isDue = !p.fsrsDue || new Date(p.fsrsDue).getTime() <= Date.now();
                return (
                  <tr
                    key={p.id}
                    className="border-b border-border/50 transition-colors hover:bg-subtle/50"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/problems/${p.id}`}
                        className="block font-medium hover:text-accent transition-colors"
                      >
                        <div className="truncate max-w-[300px]">{p.title}</div>
                        {p.topicTags.length > 0 && (
                          <p className="mt-0.5 truncate text-[11px] text-muted">
                            {p.topicTags.map((t) => `#${t}`).join("  ")}
                          </p>
                        )}
                      </Link>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-2.5">
                      <DifficultyPill difficulty={p.difficulty} />
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "font-mono text-xs tabular-nums",
                          isDue ? "text-accent font-medium" : "text-muted",
                        )}
                      >
                        {isDue && p.fsrsReps > 0 ? "now" : formatRelative(p.fsrsDue)}
                      </span>
                    </td>
                    <td className="hidden md:table-cell px-4 py-2.5 font-mono text-xs tabular-nums">
                      {p.fsrsReps}
                      {p.fsrsLapses > 0 && <span className="text-danger ml-0.5">↓{p.fsrsLapses}</span>}
                    </td>
                    <td className="hidden md:table-cell px-4 py-2.5 font-mono text-xs tabular-nums">
                      <span className={p.cardTotal > 0 ? "text-accent" : "text-muted"}>
                        {p.cardTotal}
                      </span>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-2.5">
                      <FsrsStatePill state={p.fsrsState} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted">No problems match the current filters.</p>
        )}
      </Surface>
    </div>
  );
}
