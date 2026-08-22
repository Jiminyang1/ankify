"use client";

import { useId } from "react";
import { useLanguage } from "./LanguageProvider";
import { cn } from "@/lib/utils";
import type { Language } from "@/lib/i18n";
import { ActiveIndicator } from "@/components/ui/motion";

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
  const indicatorId = useId();
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
            "relative isolate font-medium transition-colors",
            size === "md" ? "min-h-10 min-w-12 rounded-md px-3 py-1.5 text-sm" : "min-h-9 rounded-md px-2 py-1 text-[11px]",
            selectedLanguage === option.value ? "text-fg" : "text-muted hover:text-fg",
          )}
          aria-pressed={selectedLanguage === option.value}
        >
          {selectedLanguage === option.value && (
            <ActiveIndicator
              layoutId={`language-toggle-${indicatorId}`}
              className="absolute inset-0 z-0 rounded-md bg-surface shadow-sm"
            />
          )}
          <span className="relative z-10">{t.language[option.labelKey]}</span>
        </button>
      ))}
    </div>
  );
}
