import { cn } from "@/lib/utils";

const FIELD_BASE =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg transition placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50";

export function Input({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD_BASE, className)} {...rest} />;
}

export function Textarea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD_BASE, "resize-y", className)} {...rest} />;
}

export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(FIELD_BASE, "cursor-pointer appearance-none pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

/**
 * Labeled field wrapper. Renders an uppercase caption above the control and
 * associates it via the rendered <label>. Keep the control as the single child.
 */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
