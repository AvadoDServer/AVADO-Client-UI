import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createRealRocketpoolApi } from "./real";
import type { RocketpoolApi } from "./types";

/** Same switch as the client app: `VITE_MOCK=1` uses the in-memory adapters. */
export const isMock = (): boolean => import.meta.env.VITE_MOCK === "1";

/**
 * The demo adapters, loaded on first use: `./mock` and its demo data are
 * imported dynamically, so a production build (VITE_MOCK unset) contains
 * neither. The scenario is read from the address now.
 */
function lazyMockApi(): RocketpoolApi {
  let search = "";
  try {
    search = window.location.search;
  } catch {
    /* no window */
  }
  const ready = import("./mock").then((m) =>
    m.createMockRocketpoolApi({ latencyMs: 250, waitMs: 3000, scenario: m.scenarioFromEnvironment(search) }),
  );
  return new Proxy({} as RocketpoolApi, {
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

/**
 * Mocks under VITE_MOCK=1 (the demo node from `?scenario=minipool|mixed|fresh|daemon-failed`,
 * default mixed), else the real adapters.
 */
export function createRocketpoolApi(): RocketpoolApi {
  // Written out (not isMock()) so the production build drops the mock branch and its dynamic import.
  if (import.meta.env.VITE_MOCK === "1") return lazyMockApi();
  return createRealRocketpoolApi();
}

const RocketpoolApiContext = createContext<RocketpoolApi | null>(null);

export function RocketpoolApiProvider({ children, api }: { children: ReactNode; /** Use these adapters instead (tests). */ api?: RocketpoolApi }) {
  const value = useMemo(() => api ?? createRocketpoolApi(), [api]);
  return <RocketpoolApiContext.Provider value={value}>{children}</RocketpoolApiContext.Provider>;
}

export function useRocketpoolApi(): RocketpoolApi {
  const api = useContext(RocketpoolApiContext);
  if (!api) throw new Error("useRocketpoolApi() must be used inside <RocketpoolApiProvider>");
  return api;
}
