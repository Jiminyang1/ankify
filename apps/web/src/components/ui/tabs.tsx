import { useId } from "react";
import { cn } from "@/lib/utils";
import { ActiveIndicator } from "./motion";

export type TabItem = {
  id: string;
  label: React.ReactNode;
};

/**
 * Presentational, accessible tab strip (role="tablist"). State lives in the
 * parent: pass the active id and an onChange handler. Pair each tab's panel
 * with role="tabpanel" and aria-labelledby={`tab-${id}`} on the consumer side.
 */
export function Tabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const indicatorId = useId();

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabButtons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    const currentIndex = tabButtons.indexOf(event.target as HTMLButtonElement);
    if (currentIndex < 0 || tabButtons.length === 0) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabButtons.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabButtons.length) %
            tabButtons.length;
    tabButtons[nextIndex]?.focus();
    tabButtons[nextIndex]?.click();
  };

  return (
    <div
      role="tablist"
      className={cn("flex items-center gap-1", className)}
      onKeyDown={moveFocus}
    >
      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              "relative isolate h-8 rounded-lg px-3 text-sm font-medium transition-colors",
              selected
                ? "text-fg"
                : "text-muted hover:bg-subtle hover:text-fg",
            )}
          >
            {selected && (
              <ActiveIndicator
                layoutId={`tabs-${indicatorId}`}
                className="absolute inset-0 z-0 rounded-lg bg-surface shadow-card"
              />
            )}
            <span className="relative z-10">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
