"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE_NAME,
  LANGUAGE_STORAGE_KEY,
  getTranslations,
  normalizeLanguage,
  type Language,
} from "@/lib/i18n";

const LanguageContext = createContext<{
  language: Language;
  setLanguage: (language: Language) => void;
  t: ReturnType<typeof getTranslations>;
}>({
  language: DEFAULT_LANGUAGE,
  setLanguage: () => {},
  t: getTranslations(DEFAULT_LANGUAGE),
});

function persistLanguage(language: Language) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {}
  try {
    document.cookie = `${LANGUAGE_COOKIE_NAME}=${language}; path=/; max-age=31536000; sameSite=lax`;
  } catch {}
  document.documentElement.lang = language === "zh" ? "zh-Hans" : "en";
}

export function LanguageProvider({
  initialLanguage,
  children,
}: {
  initialLanguage: Language;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window === "undefined") return initialLanguage;
    return normalizeLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? initialLanguage);
  });

  useEffect(() => {
    persistLanguage(language);
    if (language !== initialLanguage) {
      router.refresh();
    }
  }, [initialLanguage, language, router]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    persistLanguage(next);
    router.refresh();
  }, [router]);

  const value = useMemo(
    () => ({ language, setLanguage, t: getTranslations(language) }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}
