import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Theme system, ported from the AVADO Admin.
 *
 *  - Applies `data-theme="dark|light"` on <html> (drives the CSS tokens).
 *  - `preference` is what the owner picked: "light", "dark" or "system"
 *    (the default). It persists to localStorage under "avado.theme";
 *    "system" is stored as the absence of the key, so a stale value never
 *    gets stuck.
 *  - `theme` is the resolved value actually painted.
 */

export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

export const THEME_STORAGE_KEY = "avado.theme";
const THEMES: Theme[] = ["dark", "light"];
const PREFERENCES: ThemePreference[] = ["dark", "light", "system"];

export function resolvePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && (THEMES as string[]).includes(stored)) return stored as Theme;
  } catch {
    /* localStorage may be unavailable (private mode) */
  }
  return "system";
}

export function resolveSystemTheme(): Theme {
  if (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark"; // AVADO default
}

export function resolveInitialTheme(): Theme {
  const preference = resolvePreference();
  return preference === "system" ? resolveSystemTheme() : preference;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export interface ThemeContextValue {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  preference: "system",
  setPreference: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(resolvePreference);
  const [theme, setThemeState] = useState<Theme>(resolveInitialTheme);

  const setPreference = useCallback((next: ThemePreference) => {
    if (!PREFERENCES.includes(next)) return;
    setPreferenceState(next);
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore persistence failures */
    }
    setThemeState(next === "system" ? resolveSystemTheme() : next);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // While preference is "system", follow the OS live.
  useEffect(() => {
    if (preference !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (e: MediaQueryListEvent) => setThemeState(e.matches ? "light" : "dark");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [preference]);

  const value = useMemo(() => ({ theme, preference, setPreference }), [theme, preference, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export default ThemeProvider;
