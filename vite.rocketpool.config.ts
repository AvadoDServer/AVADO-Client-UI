import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { fileURLToPath } from "node:url";
import rocketpoolTailwind from "./tailwind.rocketpool.config";

const repo = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** The Rocket Pool app's entry directory (its own index.html). */
export const ROCKETPOOL_ROOT = repo("./src/apps/rocketpool");
export const ROCKETPOOL_OUT_DIR = repo("./dist-rocketpool");

// The Rocket Pool app: a second SPA on the same design system. Its own root
// (src/apps/rocketpool/index.html) and output (dist-rocketpool/), so the
// client app's `yarn build` → dist/ is untouched by it.
export default defineConfig({
  root: ROCKETPOOL_ROOT,
  // Same as the client app: served at the web root of the package host.
  base: "/",
  // .env files and VITE_MOCK are read from the repo root, as for the client app.
  envDir: repo("."),
  // public/ holds the client app's dev client-config.json; the Rocket Pool app has none.
  publicDir: false,
  plugins: [react()],
  css: {
    postcss: { plugins: [tailwindcss(rocketpoolTailwind), autoprefixer()] },
  },
  build: {
    outDir: ROCKETPOOL_OUT_DIR,
    // outDir is outside root: Vite only empties it when asked.
    emptyOutDir: true,
    sourcemap: false,
  },
});
