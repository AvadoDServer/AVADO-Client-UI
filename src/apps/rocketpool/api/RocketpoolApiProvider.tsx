import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createMockRocketpoolApi } from "./mock";
import { createRealRocketpoolApi } from "./real";
import type { RocketpoolApi } from "./types";

/** Same switch as the client app: `VITE_MOCK=1` uses the in-memory adapters. */
export const isMock = (): boolean => import.meta.env.VITE_MOCK === "1";

/** Mocks under VITE_MOCK=1, else the real adapters. */
export function createRocketpoolApi(): RocketpoolApi {
  if (isMock()) return createMockRocketpoolApi({ latencyMs: 250 });
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
