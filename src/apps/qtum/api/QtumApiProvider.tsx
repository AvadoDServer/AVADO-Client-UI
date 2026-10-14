import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createRealQtumApi } from "./real";
import type { QtumApi } from "./types";

/** Same switch as the client app: `VITE_MOCK=1` uses the in-memory package. */
export const isMock = (): boolean => import.meta.env.VITE_MOCK === "1";

/**
 * The demo package, loaded on first use: `./mock` and its demo data are
 * imported dynamically, so a production build (VITE_MOCK unset) contains
 * neither. The scenario is read from the address now.
 */
function lazyMockApi(): QtumApi {
  let search = "";
  try {
    search = window.location.search;
  } catch {
    /* no window */
  }
  const ready = import("./mock").then((m) => m.createMockQtumApi({ latencyMs: 250, settleMs: 4000, scenario: m.scenarioFromEnvironment(search) }));
  return new Proxy({} as QtumApi, {
    // Only the API's methods; never a "then" (so the object is not mistaken for a promise) nor a symbol.
    get: (_target, key) =>
      typeof key !== "string" || key === "then"
        ? undefined
        : async (...args: unknown[]) => {
            const api = (await ready) as unknown as Record<string, (...a: unknown[]) => unknown>;
            return api[key](...args);
          },
  });
}

/** Mocks under VITE_MOCK=1 (the demo node from `?scenario=…`, default staking), else the real adapters. */
export function createQtumApi(): QtumApi {
  // Written out (not isMock()) so the production build drops the mock branch and its dynamic import.
  if (import.meta.env.VITE_MOCK === "1") return lazyMockApi();
  return createRealQtumApi();
}

const QtumApiContext = createContext<QtumApi | null>(null);

export function QtumApiProvider({ children, api }: { children: ReactNode; /** Use these adapters instead (tests). */ api?: QtumApi }) {
  const value = useMemo(() => api ?? createQtumApi(), [api]);
  return <QtumApiContext.Provider value={value}>{children}</QtumApiContext.Provider>;
}

export function useQtumApi(): QtumApi {
  const api = useContext(QtumApiContext);
  if (!api) throw new Error("useQtumApi() must be used inside <QtumApiProvider>");
  return api;
}
