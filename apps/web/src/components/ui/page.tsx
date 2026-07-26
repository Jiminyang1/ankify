import { cn } from "@/lib/utils";

const WIDTH = {
  standard: "max-w-5xl",
  wide: "max-w-6xl",
  full: "max-w-7xl",
} as const;

export function PageFrame({
  children,
  className,
  width = "wide",
}: {
  children: React.ReactNode;
  className?: string;
  width?: keyof typeof WIDTH;
}) {
  return (
    <div className={cn("mx-auto w-full", WIDTH[width], className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  );
}
