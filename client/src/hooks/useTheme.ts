import { useState, useEffect, useCallback } from "react";
import { STORAGE_KEYS } from "../constants";

type Theme = "light" | "dark" | "system";

function getEffectiveTheme(preference: Theme): "light" | "dark" {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return preference;
}

function applyTheme(preference: Theme) {
  if (preference === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", preference);
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.theme);
    if (stored === "light" || stored === "dark" || stored === "system")
      return stored;
    return "dark";
  });

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEYS.theme, theme);
  }, [theme]);

  // Re-apply when system preference changes (only matters in "system" mode)
  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const effective = getEffectiveTheme(theme);
    setThemeState(effective === "light" ? "dark" : "light");
  }, [theme]);

  return { theme, toggleTheme, effectiveTheme: getEffectiveTheme(theme) };
}
