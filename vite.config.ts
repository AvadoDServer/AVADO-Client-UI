/// <reference types="vitest" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

// public/client-config.json is a dev sample only. Each client Dockerfile
// writes the real one, so keep it out of dist/: a package that forgot to
// write it then falls back to the hostname instead of posing as Nimbus.
const dropDevClientConfig = (): Plugin => {
  let outDir = "dist";
  return {
    name: "drop-dev-client-config",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      rmSync(resolve(outDir, "client-config.json"), { force: true });
    },
  };
};

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
