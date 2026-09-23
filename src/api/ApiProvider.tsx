import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useClientConfig } from "../config/ClientConfigProvider";
import type { ClientConfig } from "../config/clientConfig";
import { createMockApi } from "./mock";
import { createRealApi } from "./real";
import type { Api } from "./types";

export const isMock = (): boolean => import.meta.env.VITE_MOCK === "1";

/** Picks the adapters for this config: mocks under VITE_MOCK=1, else the real ones. */
export function createApi(config: ClientConfig): Api {
  if (isMock()) return createMockApi({ latencyMs: 250 });
  return createRealApi(config);
}

const ApiContext = createContext<Api | null>(null);

export interface ApiProviderProps {
  children: ReactNode;
  /** Use these adapters instead (tests). */
  api?: Api;
}

export function ApiProvider({ children, api }: ApiProviderProps) {
  const config = useClientConfig();
  const value = useMemo(() => api ?? createApi(config), [api, config]);
  // Close the WAMP session of adapters this provider created.
  useEffect(() => {
    if (api) return;
    return () => (value as Partial<{ dispose(): void }>).dispose?.();
  }, [api, value]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi() must be used inside <ApiProvider>");
  return api;
}
