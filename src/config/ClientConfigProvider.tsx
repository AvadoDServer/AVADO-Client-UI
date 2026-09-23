import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Spinner } from "../components/ui";
import { loadClientConfigResult, type ClientConfig, type ClientConfigResult } from "./clientConfig";

const ClientConfigContext = createContext<ClientConfigResult | null>(null);

export interface ClientConfigProviderProps {
  children: ReactNode;
  /** Skip loading and use this config, as if read from the file (tests, previews). */
  config?: ClientConfig;
  /** Skip loading and use this full result (tests of the "wrong configuration" banner). */
  result?: ClientConfigResult;
  /** Override the loader (tests). */
  load?: () => Promise<ClientConfigResult>;
}

/** Loads the runtime config once and renders children when it's ready. */
export function ClientConfigProvider({ children, config, result, load = loadClientConfigResult }: ClientConfigProviderProps) {
  const [loaded, setLoaded] = useState<ClientConfigResult | null>(null);

  useEffect(() => {
    if (result || config) return;
    let cancelled = false;
    load().then((r) => {
      if (!cancelled) setLoaded(r);
    });
    return () => {
      cancelled = true;
    };
  }, [config, result, load]);

  const value = useMemo<ClientConfigResult | null>(
    () => result ?? (config ? { config, source: "file", problems: [] } : loaded),
    [result, config, loaded],
  );

  if (!value) {
    return (
      <div className="flex min-h-screen items-center justify-center text-fg-muted">
        <Spinner size="lg" label="Loading" />
      </div>
    );
  }
  return <ClientConfigContext.Provider value={value}>{children}</ClientConfigContext.Provider>;
}

/**
 * The config plus where it came from ("file" | "hostname" | "default") and
 * the problems found. Non-empty `problems` means "wrong configuration".
 * Throws outside <ClientConfigProvider>.
 */
export function useClientConfigStatus(): ClientConfigResult {
  const c = useContext(ClientConfigContext);
  if (!c) throw new Error("useClientConfig() must be used inside <ClientConfigProvider>");
  return c;
}

/** The runtime config. Throws outside <ClientConfigProvider>. */
export function useClientConfig(): ClientConfig {
  return useClientConfigStatus().config;
}
