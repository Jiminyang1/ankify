"use client";

import { useTheme } from "./ThemeProvider";
import { useLanguage } from "./LanguageProvider";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const { t } = useLanguage();
  const options = [
    { value: "system", label: t.theme.system },
    { value: "light", label: t.theme.light },
    { value: "dark", label: t.theme.dark },
  ] as const;

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-md border border-border bg-subtle p-0.5",
        className,
      )}
      aria-label={t.theme.label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setTheme(option.value)}
          className={cn(
            "rounded px-2 py-1 text-[11px] font-semibold transition",
            theme === option.value
              ? "bg-surface text-fg shadow-sm"
              : "text-muted hover:text-fg",
          )}
          aria-pressed={theme === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
