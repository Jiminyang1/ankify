"use client";

import { useTheme } from "./ThemeProvider";
import { useLanguage } from "./LanguageProvider";
import { cn } from "@/lib/utils";

export function ThemeToggle({
  className,
  size = "sm",
}: {
  className?: string;
  size?: "sm" | "md";
}) {
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
        "flex items-center rounded-md border border-border bg-subtle",
        size === "md" ? "gap-1 p-1" : "gap-0.5 p-0.5",
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
            "font-semibold transition",
            size === "md" ? "min-w-16 rounded-md px-3 py-1.5 text-sm" : "rounded px-2 py-1 text-[11px]",
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
