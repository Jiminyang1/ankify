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
  value,
  onChange,
}: {
  className?: string;
  size?: "sm" | "md";
  value?: Language;
  onChange?: (language: Language) => void;
}) {
  const { language, setLanguage, t } = useLanguage();
  const selectedLanguage = value ?? language;
  const selectLanguage = onChange ?? setLanguage;

  return (
    <div
      className={cn(
        "flex items-center rounded-lg border border-border bg-subtle shadow-card",
        size === "md" ? "gap-1 p-1" : "gap-0.5 p-0.5",
        className,
      )}
      aria-label={t.language.label}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => selectLanguage(option.value)}
          className={cn(
            "font-medium transition",
            size === "md" ? "min-h-10 min-w-12 rounded-md px-3 py-1.5 text-sm" : "min-h-9 rounded-md px-2 py-1 text-[11px]",
            selectedLanguage === option.value ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
          )}
          aria-pressed={selectedLanguage === option.value}
        >
          {t.language[option.labelKey]}
        </button>
      ))}
    </div>
  );
}
