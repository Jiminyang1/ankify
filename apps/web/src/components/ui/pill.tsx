import { cn } from "@/lib/utils";
import { translateDifficulty, translateFsrsState, type Language } from "@/lib/i18n";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "easy" | "medium" | "hard";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-subtle text-muted border-border",
  accent: "bg-accent-soft text-accent border-accent/30",
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  danger: "bg-danger/10 text-danger border-danger/30",
  easy: "bg-easy/10 text-easy border-easy/30",
  medium: "bg-medium/10 text-medium border-medium/30",
  hard: "bg-hard/10 text-hard border-hard/30",
};

export function Pill({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const FSRS_TONE: Record<string, Tone> = {
  new: "accent",
  learning: "warning",
  review: "success",
  relearning: "danger",
};

export function FsrsStatePill({ state, language = "en" }: { state: string; language?: Language }) {
  return <Pill tone={FSRS_TONE[state] ?? "neutral"}>{translateFsrsState(language, state)}</Pill>;
}

export function DifficultyPill({ difficulty, language = "en" }: { difficulty: string; language?: Language }) {
  const tone: Tone =
    difficulty === "Easy" ? "easy" : difficulty === "Hard" ? "hard" : "medium";
  return <Pill tone={tone}>{translateDifficulty(language, difficulty)}</Pill>;
}
