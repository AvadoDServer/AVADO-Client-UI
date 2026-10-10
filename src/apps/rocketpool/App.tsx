import type { ReactNode } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { ROUTER_FUTURE } from "../../routing/routerFuture";
import { ModeProvider } from "../../settings/ModeProvider";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { RocketpoolApiProvider } from "./api/RocketpoolApiProvider";
import type { RocketpoolApi } from "./api/types";
import AdvancedPage from "./pages/advanced/AdvancedPage";
import HomePage from "./pages/HomePage";
import NotFound from "./pages/NotFound";
import SetupPage from "./pages/setup/SetupPage";
import RewardsPage from "./pages/rewards/RewardsPage";
import RplPage from "./pages/rpl/RplPage";
import ValidatorsPage from "./pages/validators/ValidatorsPage";
import WalletPage from "./pages/wallet/WalletPage";
import { RocketpoolShell } from "./RocketpoolShell";
import { PendingTxProvider } from "./tx/pending";

/** Theme, mode, API and pending-transaction context around the Rocket Pool app. */
export function Providers({ children, api }: { children: ReactNode; api?: RocketpoolApi }) {
  return (
    <ThemeProvider>
      <ModeProvider>
        <RocketpoolApiProvider api={api}>
          <PendingTxProvider>{children}</PendingTxProvider>
        </RocketpoolApiProvider>
      </ModeProvider>
    </ThemeProvider>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<RocketpoolShell />}>
        <Route index element={<HomePage />} />
        <Route path="setup" element={<SetupPage />} />
        <Route path="setup/:step" element={<SetupPage />} />
        <Route path="validators" element={<ValidatorsPage />} />
        <Route path="rewards" element={<RewardsPage />} />
        <Route path="wallet" element={<WalletPage />} />
        <Route path="rpl" element={<RplPage />} />
        <Route path="advanced" element={<AdvancedPage />} />
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
