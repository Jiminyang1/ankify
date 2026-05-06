"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
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

function applyThemePreference(preference: ThemePreference) {
  if (preference === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", preference);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => {
    const stored = localStorage.getItem("ankify-theme");
    if (stored === "system" || stored === "light" || stored === "dark") {
      setPreference(stored);
    }
  }, []);

  useEffect(() => {
    applyThemePreference(preference);
    localStorage.setItem("ankify-theme", preference);
  }, [preference]);

  const setTheme = useCallback((t: ThemePreference) => {
    setPreference(t);
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
