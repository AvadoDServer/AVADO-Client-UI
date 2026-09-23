import { useEffect, useState, type ReactNode } from "react";
import { ApiProvider, useApi } from "./api/ApiProvider";
import { Badge, Button, Card, CardDescription, CardHeader, CardTitle, StatusPill } from "./components/ui";
import { ClientConfigProvider, useClientConfig } from "./config/ClientConfigProvider";
import type { ClientConfig } from "./config/clientConfig";
import { ModeProvider, useMode } from "./settings/ModeProvider";
import { ThemeProvider, useTheme, type ThemePreference } from "./theme/ThemeProvider";
import type { Api } from "./api/types";

const CLIENT_TITLE: Record<ClientConfig["client"], string> = {
  nimbus: "Nimbus",
  teku: "Teku",
  prysm: "Prysm",
  lighthouse: "Lighthouse",
};

/** Theme, mode, config and API context around the app. */
export function Providers({ children, config, api }: { children: ReactNode; config?: ClientConfig; api?: Api }) {
  return (
    <ThemeProvider>
      <ModeProvider>
        <ClientConfigProvider config={config}>
          <ApiProvider api={api}>{children}</ApiProvider>
        </ClientConfigProvider>
      </ModeProvider>
    </ThemeProvider>
  );
}

/** Placeholder until the shell and pages land (later tasks). */
function PlaceholderPage() {
  const config = useClientConfig();
  const api = useApi();
  const { preference, setPreference } = useTheme();
  const { mode, setMode } = useMode();
  const [keys, setKeys] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.keymanager
      .listKeystores()
      .then((k) => !cancelled && setKeys(k.length))
      .catch(() => !cancelled && setKeys(null));
    return () => {
      cancelled = true;
    };
  }, [api]);

  const title = `AVADO ${CLIENT_TITLE[config.client]}`;
  useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <h1 className="font-display text-4xl font-bold tracking-tight">{title}</h1>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Client UI foundation</CardTitle>
            <CardDescription>The pages arrive in the next steps. This page checks the building blocks.</CardDescription>
          </div>
          <Badge variant={config.network === "mainnet" ? "accent" : "warning"}>{config.network}</Badge>
        </CardHeader>
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-fg-muted">Package</dt>
          <dd className="break-all">{config.packageName}</dd>
          <dt className="text-fg-muted">API</dt>
          <dd className="break-all">{config.apiUrl}</dd>
          <dt className="text-fg-muted">Validators</dt>
          <dd>
            <StatusPill
              status={keys === null ? { tone: "neutral", label: "Not available" } : { tone: "success", label: `${keys} keys` }}
            />
          </dd>
        </dl>
      </Card>
      <Card>
        <CardTitle>Appearance</CardTitle>
        <div className="mt-4 flex flex-wrap gap-2">
          {(["light", "dark", "system"] as ThemePreference[]).map((p) => (
            <Button key={p} size="sm" variant={preference === p ? "primary" : "secondary"} onClick={() => setPreference(p)}>
              {p === "system" ? "Match computer" : p === "light" ? "Light" : "Dark"}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setMode(mode === "advanced" ? "simple" : "advanced")}>
            {mode === "advanced" ? "Switch to simple" : "Switch to advanced"}
          </Button>
        </div>
      </Card>
    </main>
  );
}

export default function App() {
  return (
    <Providers>
      <PlaceholderPage />
    </Providers>
  );
}
