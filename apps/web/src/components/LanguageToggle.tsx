"use client";

import { useLanguage } from "./LanguageProvider";
import { cn } from "@/lib/utils";
import type { Language } from "@/lib/i18n";

const OPTIONS: { value: Language; labelKey: "en" | "zh" }[] = [
  { value: "en", labelKey: "en" },
  { value: "zh", labelKey: "zh" },
];

export function LanguageToggle({ className }: { className?: string }) {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div
      className={cn("flex items-center gap-0.5 rounded-md border border-border bg-subtle p-0.5", className)}
      aria-label={t.language.label}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setLanguage(option.value)}
          className={cn(
            "rounded px-2 py-1 text-[11px] font-semibold transition",
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
