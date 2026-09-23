import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/500.css";
import "@fontsource/public-sans/600.css";
import "@fontsource/public-sans/700.css";
import "@fontsource/sen/600.css";
import "@fontsource/sen/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./theme.css";
import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { redirectLegacyPath } from "./routing/legacyPaths";
import { applyTheme, resolveInitialTheme } from "./theme/ThemeProvider";

// Old bookmarks (/settings, /admin) become hash routes before the router starts.
redirectLegacyPath();

// Paint the right theme before React mounts (no flash).
applyTheme(resolveInitialTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
