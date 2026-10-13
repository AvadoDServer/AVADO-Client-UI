import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { fileURLToPath } from "node:url";
import qtumTailwind from "./tailwind.qtum.config";

const repo = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** The Qtum app's entry directory (its own index.html). */
export const QTUM_ROOT = repo("./src/apps/qtum");
export const QTUM_OUT_DIR = repo("./dist-qtum");

// The Qtum Staking app: another SPA on the same design system, like the
// Rocket Pool app. Its own root (src/apps/qtum/index.html) and output
// (dist-qtum/), so the client app's `yarn build` → dist/ is untouched by it.
export default defineConfig({
  root: QTUM_ROOT,
  // Same as the client app: served at the web root of the package host.
  base: "/",
  // .env files and VITE_MOCK are read from the repo root, as for the client app.
  envDir: repo("."),
  // public/ holds the client app's dev client-config.json; the Qtum app has none.
  publicDir: false,
  plugins: [react()],
  css: {
    postcss: { plugins: [tailwindcss(qtumTailwind), autoprefixer()] },
  },
  build: {
    outDir: QTUM_OUT_DIR,
    // outDir is outside root: Vite only empties it when asked.
    emptyOutDir: true,
    sourcemap: false,
  },
});
