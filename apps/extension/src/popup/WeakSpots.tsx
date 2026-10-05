import { useState } from "react";
import { builtinWeaknessCategoryName } from "@ankify/core";
import type { WeaknessDto } from "@ankify/contracts";

export type WeakSpotsCopy = {
  title: string;
  analyze: string;
  empty: string;
  remove: string;
  resolved: (count: number) => string;
  timesSeen: (count: number) => string;
};

/** A problem's weak spots, pinned above its Coach chat (docs/coach-practice.md, v2). */
export function WeakSpots({
  weaknesses,
  language,
  copy,
  busy,
  onAnalyze,
  onRemove,
}: {
  weaknesses: WeaknessDto[];
  language: "en" | "zh";
  copy: WeakSpotsCopy;
  busy: boolean;
  onAnalyze: () => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const active = weaknesses.filter((weakness) => weakness.status === "active");
  const resolved = weaknesses.length - active.length;

  if (weaknesses.length === 0) {
    return (
      <div className="weak-spots weak-spots-empty">
        <p className="popup-muted">{copy.empty}</p>
        <button type="button" className="btn-xs btn-xs-accent" disabled={busy} onClick={onAnalyze}>
          {copy.analyze}
        </button>
      </div>
    );
  }

  return (
    <div className="weak-spots">
      <button type="button" className="weak-spots-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="coach-dock-title">{copy.title}</span>
        <span className="weak-spots-count">
          {active.length}
          {resolved > 0 && <span className="popup-muted"> · {copy.resolved(resolved)}</span>}
        </span>
      </button>
      {open && (
        <ul className="weak-spots-list">
          {active.map((weakness) => (
            <li key={weakness.id} className="weak-spot">
              <span className="weak-spot-category">
                {weakness.categoryName ?? builtinWeaknessCategoryName(weakness.category, language) ?? weakness.category}
              </span>
              <span className="weak-spot-detail">
                {weakness.detail}
                {weakness.hitCount > 1 && <span className="popup-muted"> · {copy.timesSeen(weakness.hitCount)}</span>}
              </span>
              <button
                type="button"
                className="weak-spot-remove"
                aria-label={copy.remove}
                title={copy.remove}
                onClick={() => onRemove(weakness.id)}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
