import { cn } from "@/lib/utils";
import { InfoTip } from "./info-tip";

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
  info,
  tone,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  info?: string;
  tone?: "default" | "accent" | "success" | "danger";
  className?: string;
}) {
  return (
    <Surface
      className={cn(
        "p-4",
        tone === "accent" && "bg-accent-soft/40 border-accent/20",
        tone === "success" && "bg-success/5 border-success/30",
        tone === "danger" && "bg-danger/5 border-danger/30",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
        <span>{label}</span>
        {info && <InfoTip label={info} align="left" />}
      </div>
      <div
        className={cn(
          "mt-1 text-3xl font-semibold tabular-nums",
          tone === "accent" && "text-accent",
          tone === "success" && "text-success",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Surface>
  );
}
