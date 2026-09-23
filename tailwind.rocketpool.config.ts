import type { Config } from "tailwindcss";
import { fileURLToPath } from "node:url";
import base from "./tailwind.config";

const repo = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The Rocket Pool app: the same tokens and theme as the client app, scanning
// its own entry plus all shared code (components, theme, settings, hooks).
const config: Config = {
  ...base,
  content: [repo("./src/apps/rocketpool/index.html"), repo("./src") + "/**/*.{ts,tsx}"],
};

export default config;
