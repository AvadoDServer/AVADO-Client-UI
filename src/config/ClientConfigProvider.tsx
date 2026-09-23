import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Spinner } from "../components/ui";
import { loadClientConfig, type ClientConfig } from "./clientConfig";

const ClientConfigContext = createContext<ClientConfig | null>(null);

export interface ClientConfigProviderProps {
  children: ReactNode;
  /** Skip loading and use this config (tests, previews). */
  config?: ClientConfig;
  /** Override the loader (tests). */
  load?: () => Promise<ClientConfig>;
}

/** Loads the runtime config once and renders children when it's ready. */
export function ClientConfigProvider({ children, config, load = loadClientConfig }: ClientConfigProviderProps) {
  const [loaded, setLoaded] = useState<ClientConfig | null>(config ?? null);

  useEffect(() => {
    if (config) {
      setLoaded(config);
      return;
    }
    let cancelled = false;
    load().then((c) => {
      if (!cancelled) setLoaded(c);
    });
    return () => {
      cancelled = true;
    };
  }, [config, load]);

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center text-fg-muted">
        <Spinner size="lg" label="Loading" />
      </div>
    );
  }
  return <ClientConfigContext.Provider value={loaded}>{children}</ClientConfigContext.Provider>;
}

export function useClientConfig(): ClientConfig {
  const c = useContext(ClientConfigContext);
  if (!c) throw new Error("useClientConfig() must be used inside <ClientConfigProvider>");
  return c;
}
