import { render, screen } from "@testing-library/react";
import {
  ClientConfigProvider,
  defaultApiUrl,
  defaultPackageName,
  guessFromHostname,
  loadClientConfig,
  normalizeClientConfig,
  useClientConfig,
  type ClientConfig,
} from "../clientConfig";

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("defaults derived from client and network", () => {
  it("mainnet has no network suffix", () => {
    expect(defaultApiUrl("nimbus", "mainnet")).toBe("http://nimbus.my.ava.do:9999");
    expect(defaultPackageName("nimbus", "mainnet")).toBe("nimbus.avado.dnp.dappnode.eth");
  });

  it("other networks add -<network>", () => {
    expect(defaultApiUrl("teku", "holesky")).toBe("http://teku-holesky.my.ava.do:9999");
    expect(defaultPackageName("teku", "holesky")).toBe("teku-holesky.avado.dnp.dappnode.eth");
    expect(defaultPackageName("lighthouse", "gnosis")).toBe("lighthouse-gnosis.avado.dnp.dappnode.eth");
  });
});

describe("normalizeClientConfig", () => {
  it("fills every missing field", () => {
    expect(normalizeClientConfig({ client: "prysm", network: "hoodi" })).toEqual({
      client: "prysm",
      network: "hoodi",
      packageName: "prysm-hoodi.avado.dnp.dappnode.eth",
      apiUrl: "http://prysm-hoodi.my.ava.do:9999",
      backend: "monitor",
      features: { batchImport: true, backup: false, zeroSync: false },
    });
  });

  it("picks the deno backend for nimbus and lighthouse, monitor for teku and prysm", () => {
    expect(normalizeClientConfig({ client: "nimbus" }).backend).toBe("deno");
    expect(normalizeClientConfig({ client: "lighthouse" }).backend).toBe("deno");
    expect(normalizeClientConfig({ client: "teku" }).backend).toBe("monitor");
    expect(normalizeClientConfig({ client: "prysm" }).backend).toBe("monitor");
  });

  it("keeps provided fields, trims a trailing slash off apiUrl, merges features", () => {
    const c = normalizeClientConfig({
      client: "nimbus",
      network: "mainnet",
      packageName: "custom.avado.dnp.dappnode.eth",
      apiUrl: "http://localhost:9999/",
      backend: "monitor",
      features: { backup: true },
    });
    expect(c.packageName).toBe("custom.avado.dnp.dappnode.eth");
    expect(c.apiUrl).toBe("http://localhost:9999");
    expect(c.backend).toBe("monitor");
    expect(c.features).toEqual({ batchImport: true, backup: true, zeroSync: false });
  });

  it("replaces invalid values with defaults", () => {
    const c = normalizeClientConfig({ client: "geth", network: "goerli", backend: "x", apiUrl: "", features: { zeroSync: "yes" } });
    expect(c.client).toBe("nimbus");
    expect(c.network).toBe("mainnet");
    expect(c.backend).toBe("deno");
    expect(c.apiUrl).toBe("http://nimbus.my.ava.do:9999");
    expect(c.features.zeroSync).toBe(false);
  });

  it("uses the fallback for missing client/network", () => {
    const c = normalizeClientConfig({}, { client: "teku", network: "holesky" });
    expect(c.packageName).toBe("teku-holesky.avado.dnp.dappnode.eth");
  });
});

describe("guessFromHostname", () => {
  it.each([
    ["nimbus.my.ava.do", { client: "nimbus", network: "mainnet" }],
    ["teku-holesky.my.ava.do", { client: "teku", network: "holesky" }],
    ["prysm-weird.my.ava.do", { client: "prysm" }],
    ["localhost", {}],
    ["my.ava.do", {}],
  ])("%s", (host, expected) => {
    expect(guessFromHostname(host)).toEqual(expected);
  });
});

describe("loadClientConfig", () => {
  it("fetches ./client-config.json and normalizes it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ client: "teku", network: "holesky" }));
    vi.stubGlobal("fetch", fetchMock);
    const c = await loadClientConfig();
    expect(fetchMock).toHaveBeenCalledWith("./client-config.json", expect.anything());
    expect(c.client).toBe("teku");
    expect(c.apiUrl).toBe("http://teku-holesky.my.ava.do:9999");
  });

  it("falls back to defaults when the file is missing (404)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse("Not Found", 404)));
    const c = await loadClientConfig();
    expect(c).toEqual(normalizeClientConfig({}));
  });

  it("falls back to defaults on a network error or bad JSON", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(loadClientConfig()).resolves.toEqual(normalizeClientConfig({}));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError("x")) }));
    await expect(loadClientConfig()).resolves.toEqual(normalizeClientConfig({}));
  });
});

describe("ClientConfigProvider", () => {
  function Probe() {
    const c = useClientConfig();
    return <span>{c.packageName}</span>;
  }

  it("shows a spinner, then provides the loaded config", async () => {
    let resolve!: (c: ClientConfig) => void;
    const load = () => new Promise<ClientConfig>((r) => (resolve = r));
    render(
      <ClientConfigProvider load={load}>
        <Probe />
      </ClientConfigProvider>,
    );
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    resolve(normalizeClientConfig({ client: "lighthouse" }));
    expect(await screen.findByText("lighthouse.avado.dnp.dappnode.eth")).toBeInTheDocument();
  });

  it("useClientConfig throws outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/ClientConfigProvider/);
  });
});
