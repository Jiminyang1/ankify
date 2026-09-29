"use client";

import { useRef } from "react";
import type { SkillDimension } from "@ankify/core";
import { useLanguage } from "@/components/LanguageProvider";
import { cn } from "@/lib/utils";

/**
 * Radio group of mistake categories rendered as chips. A custom control (like
 * quiz answer choices), so it stays raw rather than composing <Button>.
 * Arrow keys move between chips, as in a native radio group.
 */
export function CategoryChips({
  categories,
  selected,
  onSelect,
  disabled,
  showHints,
  label,
}: {
  categories: SkillDimension[];
  selected: SkillDimension | null;
  onSelect: (category: SkillDimension) => void;
  disabled?: boolean;
  showHints?: boolean;
  label: string;
}) {
  const { t } = useLanguage();
  const groupRef = useRef<HTMLDivElement>(null);
  const focusIndex = Math.max(0, selected ? categories.indexOf(selected) : 0);

  function moveFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1
      : 0;
    if (step === 0) return;
    const chips = Array.from(groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    const current = chips.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    chips[(current + step + chips.length) % chips.length]?.focus();
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      onKeyDown={moveFocus}
      className={showHints ? "grid gap-2 sm:grid-cols-2" : "flex flex-wrap gap-2"}
    >
      {categories.map((category, index) => {
        const checked = selected === category;
        return (
          <button
            key={category}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === focusIndex ? 0 : -1}
            disabled={disabled}
            title={showHints ? undefined : t.mistakes.categoryHints[category]}
            onClick={() => onSelect(category)}
            className={cn(
              "rounded-lg border text-left transition disabled:cursor-not-allowed disabled:opacity-50",
              showHints ? "px-3 py-2" : "px-3 py-1.5 text-xs font-medium",
              checked
                ? "border-accent/50 bg-accent-soft text-accent"
                : "border-border bg-surface text-fg hover:border-accent/30 hover:bg-subtle",
            )}
          >
            <span className={cn(showHints && "block text-sm font-medium")}>{t.mistakes.categories[category]}</span>
            {showHints && (
              <span className={cn("mt-0.5 block text-xs", checked ? "text-accent/80" : "text-muted")}>
                {t.mistakes.categoryHints[category]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
