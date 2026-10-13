import type { ReactNode } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { ROUTER_FUTURE } from "../../routing/routerFuture";
import { ModeProvider } from "../../settings/ModeProvider";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { QtumApiProvider } from "./api/QtumApiProvider";
import type { QtumApi } from "./api/types";
import AdvancedPage from "./pages/advanced/AdvancedPage";
import HomePage from "./pages/home/HomePage";
import NotFound from "./pages/NotFound";
import SettingsPage from "./pages/settings/SettingsPage";
import WalletPage from "./pages/wallet/WalletPage";
import { QtumShell } from "./QtumShell";

/** Theme, mode and API context around the Qtum app. */
export function Providers({ children, api }: { children: ReactNode; api?: QtumApi }) {
  return (
    <ThemeProvider>
      <ModeProvider>
        <QtumApiProvider api={api}>{children}</QtumApiProvider>
      </ModeProvider>
    </ThemeProvider>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<QtumShell />}>
        <Route index element={<HomePage />} />
        <Route path="wallet" element={<WalletPage />} />
        <Route path="settings" element={<SettingsPage />} />
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
