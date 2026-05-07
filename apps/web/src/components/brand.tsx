import { cn } from "@/lib/utils";

type BrandSize = "sm" | "md" | "lg";

const markSizes: Record<BrandSize, string> = {
  sm: "h-7 w-11",
  md: "h-9 w-14",
  lg: "h-12 w-[4.5rem]",
};

const wordSizes: Record<BrandSize, string> = {
  sm: "text-[1.35rem]",
  md: "text-3xl",
  lg: "text-5xl",
};

const tagSizes: Record<BrandSize, string> = {
  sm: "text-[9px] tracking-[0.18em]",
  md: "text-[11px] tracking-[0.20em]",
  lg: "text-sm tracking-[0.24em]",
};

export function BrandMark({ size = "md", className }: { size?: BrandSize; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center text-accent",
        markSizes[size],
        className,
      )}
    >
      <svg viewBox="0 0 64 64" className="h-full w-full" role="img">
        <rect x="9" y="27" width="12" height="27" rx="4.5" fill="currentColor" opacity="0.42" />
        <rect x="27" y="20" width="12" height="34" rx="4.5" fill="currentColor" opacity="0.72" />
        <rect x="45" y="10" width="16" height="50" rx="6" fill="currentColor" />
        <circle cx="53" cy="23" r="3" fill="#141418" />
      </svg>
    </span>
  );
}

export function BrandWordmark({ size = "md", className }: { size?: BrandSize; className?: string }) {
  return (
    <span
      className={cn(
        "font-mono font-black leading-none tracking-tight text-fg",
        wordSizes[size],
        className,
      )}
    >
      ankify<span className="text-accent">.</span>
    </span>
  );
}

export function BrandLockup({
  size = "md",
  showTag = false,
  className,
}: {
  size?: BrandSize;
  showTag?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)} aria-label="ankify">
      <BrandMark size={size} />
      <span className="min-w-0 leading-none">
        <BrandWordmark size={size} />
        {showTag && (
          <span className={cn("mt-2 block font-mono font-bold uppercase text-muted", tagSizes[size])}>
            Spaced · Repetition
          </span>
        )}
      </span>
    </span>
  );
}

export function BrandBanner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-4 rounded-xl border border-border bg-surface px-4 py-3 shadow-card",
        className,
      )}
      aria-label="ankify spaced repetition"
    >
      <BrandMark size="lg" />
      <div className="min-w-0">
        <BrandWordmark size="lg" />
        <div className="mt-2 font-mono text-sm font-bold uppercase tracking-[0.24em] text-muted">
          Spaced · Repetition
        </div>
      </div>
    </div>
  );
}
