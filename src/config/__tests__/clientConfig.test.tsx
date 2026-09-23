import { render, screen } from "@testing-library/react";
import {
  checkClientConfig,
  ClientConfigProvider,
  defaultApiUrl,
  defaultPackageName,
  guessFromHostname,
  loadClientConfig,
  loadClientConfigResult,
  normalizeClientConfig,
  useClientConfig,
  useClientConfigStatus,
  type ClientConfigResult,
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

  it("prysm is prysm-beacon-chain-<network>, mainnet included", () => {
    expect(defaultPackageName("prysm", "mainnet")).toBe("prysm-beacon-chain-mainnet.avado.dnp.dappnode.eth");
    expect(defaultApiUrl("prysm", "mainnet")).toBe("http://prysm-beacon-chain-mainnet.my.ava.do:9999");
    expect(defaultApiUrl("prysm", "holesky")).toBe("http://prysm-beacon-chain-holesky.my.ava.do:9999");
  });
});

describe("normalizeClientConfig", () => {
  it("fills every missing field", () => {
    expect(normalizeClientConfig({ client: "prysm", network: "hoodi" })).toEqual({
      client: "prysm",
      network: "hoodi",
      packageName: "prysm-beacon-chain-hoodi.avado.dnp.dappnode.eth",
      apiUrl: "http://prysm-beacon-chain-hoodi.my.ava.do:9999",
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

describe("checkClientConfig problems (wrong configuration)", () => {
  it("a complete, valid file has no problems", () => {
    expect(checkClientConfig({ client: "teku", network: "holesky", backend: "monitor", features: { backup: true } }).problems).toEqual([]);
  });

  it("optional fields may be missing without a problem", () => {
    expect(checkClientConfig({ client: "nimbus", network: "mainnet" }).problems).toEqual([]);
  });

  it.each([
    [{ client: "geth", network: "mainnet" }, /Unknown client "geth"/],
    [{ network: "mainnet" }, /No client set/],
    [{ client: "nimbus", network: "goerli" }, /Unknown network "goerli"/],
    [{ client: "nimbus" }, /No network set/],
    [{ client: "nimbus", network: "mainnet", backend: "rust" }, /Unknown backend "rust"/],
    [{ client: "nimbus", network: "mainnet", apiUrl: "" }, /Invalid apiUrl/],
    [{ client: "nimbus", network: "mainnet", packageName: 42 }, /Invalid packageName 42/],
    [{ client: "nimbus", network: "mainnet", features: [] }, /Invalid features/],
    [{ client: "nimbus", network: "mainnet", features: { zeroSync: "yes" } }, /Invalid features.zeroSync "yes"/],
    ["just a string", /not a JSON object/],
  ])("%j", (raw, problem) => {
    const { problems } = checkClientConfig(raw);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(problem);
  });

  it("lists every problem, not just the first", () => {
    expect(checkClientConfig({ client: "x", network: "y", backend: "z" }).problems).toHaveLength(3);
  });
});

describe("guessFromHostname", () => {
  it.each([
    ["nimbus.my.ava.do", { client: "nimbus", network: "mainnet" }],
    ["teku-holesky.my.ava.do", { client: "teku", network: "holesky" }],
    ["prysm-beacon-chain-mainnet.my.ava.do", { client: "prysm", network: "mainnet" }],
    ["prysm-beacon-chain-hoodi.my.ava.do", { client: "prysm", network: "hoodi" }],
    ["prysm-beacon-chain.my.ava.do", { client: "prysm" }],
    ["teku-weird.my.ava.do", { client: "teku" }],
    ["tekufoo.my.ava.do", {}],
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

describe("loadClientConfigResult", () => {
  it("source is file, with no problems, for a good file", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ client: "nimbus", network: "mainnet" })));
    const r = await loadClientConfigResult();
    expect(r.source).toBe("file");
    expect(r.problems).toEqual([]);
  });

  it("source is file, with problems, for an unknown network", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ client: "teku", network: "goerli" })));
    const r = await loadClientConfigResult();
    expect(r.source).toBe("file");
    expect(r.config.network).toBe("mainnet");
    expect(r.problems).toEqual([expect.stringMatching(/Unknown network "goerli"/)]);
  });

  it("source is default, with the reason, when the file is missing on an unknown host", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse("Not Found", 404)));
    const r = await loadClientConfigResult();
    expect(r.source).toBe("default");
    expect(r.problems).toEqual([expect.stringMatching(/could not be loaded \(HTTP 404\)/)]);
  });

  it("source is hostname when the file is missing but the address names a client", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("location", { ...window.location, hostname: "teku-holesky.my.ava.do" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const r = await loadClientConfigResult();
    expect(r.source).toBe("hostname");
    expect(r.config.client).toBe("teku");
    expect(r.config.network).toBe("holesky");
    expect(r.problems[0]).toMatch(/guessed from the page address: teku on holesky/);
  });

  it("an HTML fallback page (not JSON) is reported as invalid JSON", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError("x")) }));
    const r = await loadClientConfigResult();
    expect(r.problems[0]).toMatch(/not valid JSON/);
  });
});

describe("ClientConfigProvider", () => {
  function Probe() {
    const c = useClientConfig();
    return <span>{c.packageName}</span>;
  }

  it("shows a spinner, then provides the loaded config", async () => {
    let resolve!: (c: ClientConfigResult) => void;
    const load = () => new Promise<ClientConfigResult>((r) => (resolve = r));
    render(
      <ClientConfigProvider load={load}>
        <Probe />
      </ClientConfigProvider>,
    );
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    resolve({ config: normalizeClientConfig({ client: "lighthouse" }), source: "file", problems: [] });
    expect(await screen.findByText("lighthouse.avado.dnp.dappnode.eth")).toBeInTheDocument();
  });

  it("useClientConfigStatus exposes source and problems", () => {
    function Status() {
      const s = useClientConfigStatus();
      return (
        <span>
          {s.source}: {s.problems.join(", ")}
        </span>
      );
    }
    render(
      <ClientConfigProvider result={{ config: normalizeClientConfig({}), source: "default", problems: ["No client set"] }}>
        <Status />
      </ClientConfigProvider>,
    );
    expect(screen.getByText("default: No client set")).toBeInTheDocument();
  });

  it("a given config counts as read from the file, with no problems", () => {
    function Status() {
      const s = useClientConfigStatus();
      return <span>{`${s.source}/${s.problems.length}`}</span>;
    }
    render(
      <ClientConfigProvider config={normalizeClientConfig({ client: "teku" })}>
        <Status />
      </ClientConfigProvider>,
    );
    expect(screen.getByText("file/0")).toBeInTheDocument();
  });

  it("useClientConfig throws outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/ClientConfigProvider/);
  });
});
