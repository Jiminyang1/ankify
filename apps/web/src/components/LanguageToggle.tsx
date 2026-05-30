"use client";

import { useLanguage } from "./LanguageProvider";
import { cn } from "@/lib/utils";
import type { Language } from "@/lib/i18n";

const OPTIONS: { value: Language; labelKey: "en" | "zh" }[] = [
  { value: "en", labelKey: "en" },
  { value: "zh", labelKey: "zh" },
];

export function LanguageToggle({
  className,
  size = "sm",
}: {
  className?: string;
  size?: "sm" | "md";
}) {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div
      className={cn(
        "flex items-center rounded-md border border-border bg-subtle",
        size === "md" ? "gap-1 p-1" : "gap-0.5 p-0.5",
        className,
      )}
      aria-label={t.language.label}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setLanguage(option.value)}
          className={cn(
            "font-semibold transition",
            size === "md" ? "min-w-12 rounded-md px-3 py-1.5 text-sm" : "rounded px-2 py-1 text-[11px]",
            language === option.value ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
          )}
          aria-pressed={language === option.value}
        >
          {t.language[option.labelKey]}
        </button>
      ))}
    </div>
  );
}
