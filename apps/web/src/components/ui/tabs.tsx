import { cn } from "@/lib/utils";

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
  return (
    <div role="tablist" className={cn("flex items-center gap-1", className)}>
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
              "rounded-md px-3 py-1.5 text-sm font-medium transition",
              selected ? "bg-accent-soft text-accent" : "text-muted hover:bg-subtle hover:text-fg",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
