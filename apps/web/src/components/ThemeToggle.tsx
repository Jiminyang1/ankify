"use client";

import { useId } from "react";
import { useTheme } from "./ThemeProvider";
import { useLanguage } from "./LanguageProvider";
import { cn } from "@/lib/utils";
import { ActiveIndicator } from "@/components/ui/motion";

export function ThemeToggle({
  className,
  size = "sm",
}: {
  className?: string;
  size?: "sm" | "md";
}) {
  const { theme, setTheme } = useTheme();
  const { t } = useLanguage();
  const indicatorId = useId();
  const options = [
    { value: "system", label: t.theme.system },
    { value: "light", label: t.theme.light },
    { value: "dark", label: t.theme.dark },
  ] as const;

  return (
    <div
      className={cn(
        "flex items-center rounded-lg border border-border bg-subtle shadow-card",
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
            "relative isolate font-medium transition-colors",
            size === "md" ? "min-h-10 min-w-16 rounded-md px-3 py-1.5 text-sm" : "min-h-9 rounded-md px-2 py-1 text-[11px]",
            theme === option.value
              ? "text-fg"
              : "text-muted hover:text-fg",
          )}
          aria-pressed={theme === option.value}
        >
          {theme === option.value && (
            <ActiveIndicator
              layoutId={`theme-toggle-${indicatorId}`}
              className="absolute inset-0 z-0 rounded-md bg-surface shadow-sm"
            />
          )}
          <span className="relative z-10">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
