/// <reference types="vitest" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

// public/client-config.json is a dev sample only. Each client Dockerfile
// writes the real one, so keep it out of dist/: a package that forgot to
// write it then falls back to the hostname instead of posing as Nimbus.
const dropDevClientConfig = (): Plugin => ({
  name: "drop-dev-client-config",
  apply: "build",
  closeBundle() {
    rmSync(resolve(__dirname, "dist/client-config.json"), { force: true });
  },
});

// `base: "./"` keeps every asset URL relative, so the built SPA works from
// any path the package's static server mounts it on (spec §3).
export default defineConfig({
  base: "./",
  plugins: [react(), dropDevClientConfig()],
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
