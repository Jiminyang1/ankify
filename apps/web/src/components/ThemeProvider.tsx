"use client";

import {
  createContext,
  useContext,
  useCallback,
  useSyncExternalStore,
} from "react";

type Theme = "dark" | "light";
type ThemePreference = "system" | Theme;

const ThemeContext = createContext<{
  preference: ThemePreference;
  theme: ThemePreference;
  setTheme: (t: ThemePreference) => void;
}>({
  preference: "system",
  theme: "system",
  setTheme: () => {},
});
const THEME_EVENT = "ankify:theme-change";

function applyThemePreference(preference: ThemePreference) {
  if (preference === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", preference);
  }
}

function readThemePreference(): ThemePreference {
  const stored = window.localStorage.getItem("ankify-theme");
  return stored === "light" || stored === "dark" ? stored : "system";
}

function subscribeTheme(onChange: () => void) {
  const handleChange = () => {
    applyThemePreference(readThemePreference());
    onChange();
  };
  window.addEventListener("storage", handleChange);
  window.addEventListener(THEME_EVENT, handleChange);
  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(THEME_EVENT, handleChange);
  };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = useSyncExternalStore<ThemePreference>(
    subscribeTheme,
    readThemePreference,
    () => "system",
  );

  const setTheme = useCallback((t: ThemePreference) => {
    applyThemePreference(t);
    window.localStorage.setItem("ankify-theme", t);
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  return (
    <ThemeContext.Provider value={{ preference, theme: preference, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
