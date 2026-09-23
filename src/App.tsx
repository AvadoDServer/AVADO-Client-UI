import type { ReactNode } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { ApiProvider } from "./api/ApiProvider";
import type { Api } from "./api/types";
import { Shell } from "./components/shell/Shell";
import { Button } from "./components/ui";
import { ClientConfigProvider } from "./config/ClientConfigProvider";
import type { ClientConfig, ClientConfigResult } from "./config/clientConfig";
import AddValidatorsPage from "./pages/add/AddValidatorsPage";
import AdvancedPage from "./pages/advanced/AdvancedPage";
import NotFound from "./pages/NotFound";
import SettingsPage from "./pages/settings/SettingsPage";
import ValidatorsPage from "./pages/validators/ValidatorsPage";
import { ModeProvider, useMode } from "./settings/ModeProvider";
import { ThemeProvider } from "./theme/ThemeProvider";

/** React Router v7 behaviour, opted into now (also silences its warnings). */
export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

/** Theme, mode, config and API context around the app. */
export function Providers({
  children,
  config,
  configResult,
  api,
}: {
  children: ReactNode;
  config?: ClientConfig;
  /** Full config result, for "wrong configuration" tests. */
  configResult?: ClientConfigResult;
  api?: Api;
}) {
  return (
    <ThemeProvider>
      <ModeProvider>
        <ClientConfigProvider config={config} result={configResult}>
          <ApiProvider api={api}>{children}</ApiProvider>
        </ClientConfigProvider>
      </ModeProvider>
    </ThemeProvider>
  );
}

/** /advanced is listed in Advanced mode only; a deep link still works and says so. */
function AdvancedRoute() {
  const { isAdvanced, setMode } = useMode();
  return (
    <>
      {!isAdvanced && (
        <div
          role="note"
          className="mb-6 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center"
        >
          <p className="min-w-0 flex-1 text-sm text-fg">
            This page is part of Advanced mode, so the menu doesn&apos;t list it in Simple mode.
          </p>
          <Button size="sm" variant="secondary" className="flex-shrink-0 self-start sm:self-center" onClick={() => setMode("advanced")}>
            Switch to advanced
          </Button>
        </div>
      )}
      <AdvancedPage />
    </>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<ValidatorsPage />} />
        <Route path="add" element={<AddValidatorsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="advanced" element={<AdvancedRoute />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <Providers>
      <HashRouter future={ROUTER_FUTURE}>
        <AppRoutes />
      </HashRouter>
    </Providers>
  );
}
