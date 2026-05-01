import { cn } from "@/lib/utils";

export function Surface({
  children,
  className,
  hover,
  as: Component = "div",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  as?: React.ElementType;
  [key: string]: unknown;
}) {
  return (
    <Component
      className={cn(
        "surface rounded-xl border border-border shadow-card transition",
        hover && "hover:shadow-card-hover hover:-translate-y-px",
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "accent" | "danger";
  className?: string;
}) {
  return (
    <Surface
      className={cn(
        "p-4",
        tone === "accent" && "bg-accent-soft/40 border-accent/20",
        tone === "danger" && "bg-danger/5 border-danger/30",
        className,
      )}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={cn("mt-1 text-3xl font-semibold tabular-nums", tone === "accent" && "text-accent")}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Surface>
  );
}
