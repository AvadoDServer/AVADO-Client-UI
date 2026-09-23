import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useClientConfig } from "../config/ClientConfigProvider";
import type { ClientConfig } from "../config/clientConfig";
import { createMockApi } from "./mock";
import type { Api } from "./types";

export const isMock = (): boolean => import.meta.env.VITE_MOCK === "1";

/**
 * Adapters that fail loudly until the real ones land (Task 2): every method
 * call rejects with a clear error. The objects are not thenable and answer
 * symbol lookups with undefined, so `await api.backend`, devtools and React
 * never hang or crash on them.
 */
function createUnavailableApi(config: ClientConfig): Api {
  const part = <T,>(name: string): T =>
    new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (typeof prop === "symbol" || prop === "then" || prop === "toJSON" || prop === "$$typeof") return undefined;
          return () => Promise.reject(new Error(`${name}.${prop}: no API adapters for ${config.client} yet`));
        },
      },
    ) as T;
  return { backend: part("backend"), beacon: part("beacon"), keymanager: part("keymanager"), dappmanager: part("dappmanager") };
}

/** Picks the adapters for this config: mocks under VITE_MOCK=1. */
export function createApi(config: ClientConfig): Api {
  if (isMock()) return createMockApi({ latencyMs: 250 });
  return createUnavailableApi(config);
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
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi() must be used inside <ApiProvider>");
  return api;
}
