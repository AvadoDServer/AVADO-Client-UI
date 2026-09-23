import type { ReactNode } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { ROUTER_FUTURE } from "../../routing/routerFuture";
import { ModeProvider } from "../../settings/ModeProvider";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { RocketpoolApiProvider } from "./api/RocketpoolApiProvider";
import type { RocketpoolApi } from "./api/types";
import HomePage from "./pages/HomePage";
import NotFound from "./pages/NotFound";
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
