import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Simple/Advanced mode, ported from the AVADO Admin. Persists to
 * localStorage under "avado.mode"; defaults to "simple" (spec §5).
 */

export type Mode = "simple" | "advanced";

export const MODE_STORAGE_KEY = "avado.mode";
const MODES: Mode[] = ["simple", "advanced"];
const DEFAULT_MODE: Mode = "simple";

function resolveInitialMode(): Mode {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (stored && (MODES as string[]).includes(stored)) return stored as Mode;
  } catch {
    /* localStorage may be unavailable — fall through */
  }
  return DEFAULT_MODE;
}

export interface ModeContextValue {
  mode: Mode;
  isAdvanced: boolean;
  setMode: (next: Mode) => void;
}

const ModeContext = createContext<ModeContextValue>({
  mode: DEFAULT_MODE,
  isAdvanced: false,
  setMode: () => {},
});

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(resolveInitialMode);

  const setMode = useCallback((next: Mode) => {
    if (!MODES.includes(next)) return;
    setModeState(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      /* the choice still holds for this session */
    }
  }, []);

  const value = useMemo(() => ({ mode, isAdvanced: mode === "advanced", setMode }), [mode, setMode]);
  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

export function useMode(): ModeContextValue {
  return useContext(ModeContext);
}

export default ModeProvider;
