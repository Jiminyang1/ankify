"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
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

const languageListeners = new Set<() => void>();

function getStoredLanguage(fallback: Language) {
  try {
    return normalizeLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? fallback);
  } catch {
    return fallback;
  }
}

function subscribeLanguage(listener: () => void) {
  languageListeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === LANGUAGE_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    languageListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function notifyLanguageChanged() {
  languageListeners.forEach((listener) => listener());
}

export function LanguageProvider({
  initialLanguage,
  children,
}: {
  initialLanguage: Language;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const language = useSyncExternalStore(
    subscribeLanguage,
    () => getStoredLanguage(initialLanguage),
    () => initialLanguage,
  );

  useEffect(() => {
    persistLanguage(language);
    if (language !== initialLanguage) {
      router.refresh();
    }
  }, [initialLanguage, language, router]);

  const setLanguage = useCallback((next: Language) => {
    persistLanguage(next);
    notifyLanguageChanged();
  }, []);

  const value = useMemo(
    () => ({ language, setLanguage, t: getTranslations(language) }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}
