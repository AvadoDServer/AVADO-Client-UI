// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { UserConfig } from "vite";
import clientTailwind from "../../../tailwind.config";
import rocketpoolTailwind from "../../../tailwind.rocketpool.config";
import clientVite from "../../../vite.config";
import rocketpoolVite, { ROCKETPOOL_OUT_DIR, ROCKETPOOL_ROOT } from "../../../vite.rocketpool.config";

const repo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const pkg = JSON.parse(readFileSync(repo("package.json"), "utf8")) as { scripts: Record<string, string> };
const client = clientVite as UserConfig;
const rocketpool = rocketpoolVite as UserConfig;

// The client packages (Nimbus first) run `yarn install --frozen-lockfile &&
// yarn build` and copy dist/. A second app must not change what that builds.
describe("yarn build: the client app, unchanged", () => {
  it("runs the default Vite config", () => {
    expect(pkg.scripts.build).toBe("tsc --noEmit && vite build");
  });

  it("builds the repo-root index.html into dist/ at base /", () => {
    expect(client.root).toBeUndefined();
    expect(client.build?.outDir).toBe("dist");
    expect(client.build?.rollupOptions?.input).toBeUndefined();
    expect(client.base).toBe("/");
    expect(client.publicDir).toBeUndefined();
  });

  it("enters through src/main.tsx", () => {
    const html = readFileSync(repo("index.html"), "utf8");
    expect(html).toContain('<script type="module" src="/src/main.tsx"></script>');
    expect(html).toContain("<title>AVADO</title>");
    expect(existsSync(repo("src/main.tsx"))).toBe(true);
  });

  it("keeps the other apps out of the client CSS", () => {
    expect(clientTailwind.content).toEqual(["./index.html", "./src/**/*.{ts,tsx}", "!./src/apps/**"]);
  });

  it("keeps the client's PostCSS setup (postcss.config.js, no inline plugins)", () => {
    expect(client.css).toBeUndefined();
  });
});

describe("yarn build:rocketpool: the Rocket Pool app", () => {
  it("runs its own Vite config", () => {
    expect(pkg.scripts["build:rocketpool"]).toBe("tsc --noEmit && vite build --config vite.rocketpool.config.ts");
    expect(pkg.scripts["dev:rocketpool"]).toBe("vite --config vite.rocketpool.config.ts");
  });

  it("builds src/apps/rocketpool/index.html into dist-rocketpool/ at base /", () => {
    expect(rocketpool.root).toBe(ROCKETPOOL_ROOT);
    expect(ROCKETPOOL_ROOT).toBe(repo("src/apps/rocketpool"));
    expect(rocketpool.build?.outDir).toBe(ROCKETPOOL_OUT_DIR);
    expect(ROCKETPOOL_OUT_DIR).toBe(repo("dist-rocketpool"));
    expect(rocketpool.build?.emptyOutDir).toBe(true);
    expect(rocketpool.base).toBe("/");
  });

  it("ships no client-config.json and reads VITE_MOCK from the repo root", () => {
    expect(rocketpool.publicDir).toBe(false);
    expect(rocketpool.envDir).toBe(repo("."));
  });

  it("enters through its own main.tsx", () => {
    const html = readFileSync(repo("src/apps/rocketpool/index.html"), "utf8");
    expect(html).toContain('<script type="module" src="./main.tsx"></script>');
    expect(html).toContain("<title>AVADO Rocket Pool</title>");
    expect(existsSync(repo("src/apps/rocketpool/main.tsx"))).toBe(true);
  });

  it("uses the same design tokens, scanning its own entry and the shared code", () => {
    expect(rocketpoolTailwind.theme).toBe(clientTailwind.theme);
    expect(rocketpoolTailwind.darkMode).toEqual(clientTailwind.darkMode);
    expect(rocketpoolTailwind.content).toEqual([repo("src/apps/rocketpool/index.html"), `${repo("src")}/**/*.{ts,tsx}`]);
  });
});
