import type { ReactNode } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { ROUTER_FUTURE } from "../../routing/routerFuture";
import { ModeProvider } from "../../settings/ModeProvider";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { RocketpoolApiProvider } from "./api/RocketpoolApiProvider";
import type { RocketpoolApi } from "./api/types";
import HomePage from "./pages/HomePage";
import NotFound from "./pages/NotFound";
import PlaceholderPage from "./pages/PlaceholderPage";
import { RocketpoolShell } from "./RocketpoolShell";

/** Theme, mode and API context around the Rocket Pool app. */
export function Providers({ children, api }: { children: ReactNode; api?: RocketpoolApi }) {
  return (
    <ThemeProvider>
      <ModeProvider>
        <RocketpoolApiProvider api={api}>{children}</RocketpoolApiProvider>
      </ModeProvider>
    </ThemeProvider>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<RocketpoolShell />}>
        <Route index element={<HomePage />} />
        <Route
          path="setup"
          element={<PlaceholderPage title="Set up your node" text="Create or restore your node wallet, register, and start validating." />}
        />
        <Route
          path="validators"
          element={<PlaceholderPage title="Validators" text="Your minipools and megapool validators, with exits and distributions." />}
        />
        <Route path="rewards" element={<PlaceholderPage title="Rewards" text="Your periodic and smoothing pool rewards, and claiming them." />} />
        <Route path="wallet" element={<PlaceholderPage title="Wallet" text="Your node wallet, its backup and your withdrawal address." />} />
        <Route
          path="advanced"
          element={<PlaceholderPage title="Advanced" text="Automatic actions, gas settings, logs and versions." />}
        />
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
