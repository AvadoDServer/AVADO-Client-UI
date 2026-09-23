import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useClientConfig } from "../config/ClientConfigProvider";
import type { ClientConfig } from "../config/clientConfig";
import { createMockApi } from "./mock";
import type { Api } from "./types";

export const isMock = (): boolean => import.meta.env.VITE_MOCK === "1";

/** Adapters that fail loudly until the real ones land (Task 2). */
function createUnavailableApi(config: ClientConfig): Api {
  const fail = () => Promise.reject(new Error(`No API adapters for ${config.client} yet`));
  const handler: ProxyHandler<object> = { get: () => fail };
  const part = <T,>() => new Proxy({}, handler) as T;
  return { backend: part(), beacon: part(), keymanager: part(), dappmanager: part() };
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
