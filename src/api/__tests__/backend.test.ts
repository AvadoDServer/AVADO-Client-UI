import { createPackageBackend } from "../backend";
import { createFetchMock, networkDown } from "./fetchMock";

const API = "http://nimbus.my.ava.do:9999";
const SETTINGS = {
  network: "mainnet",
  ee_endpoint: "http://ethchain-geth.my.ava.do:8551",
  validators_graffiti: "Avado",
  mev_boost: true,
  some_future_field: { nested: [1, 2] },
};
const PROCESSES = [
  { name: "nimbus", statename: "RUNNING", pid: 42 },
  { name: "server", statename: "RUNNING", pid: 7 },
];

describe.each(["deno", "monitor"] as const)("createPackageBackend (%s)", (kind) => {
  // The deno server sends settings as a JSON object; the monitor double-encodes
  // them (res.send(200, JSON.stringify(settings)) → a JSON string).
  const wire = (v: unknown) => (kind === "monitor" ? { json: JSON.stringify(v) } : { json: v });

  it("getSettings returns the object, decoding the monitor's JSON string", async () => {
    const m = createFetchMock().on("GET", `${API}/settings`, wire(SETTINGS));
    const backend = createPackageBackend({ apiUrl: API, backend: kind }, { fetch: m.fetch });
    expect(await backend.getSettings()).toEqual(SETTINGS);
  });

  it("getSettings rejects a body that is not an object", async () => {
    const m = createFetchMock().on("GET", `${API}/settings`, { text: "<html>" });
    const backend = createPackageBackend({ apiUrl: API, backend: kind }, { fetch: m.fetch });
    await expect(backend.getSettings()).rejects.toMatchObject({ kind: "invalid", service: "backend" });
  });

  it("getDefaultSettings returns the defaults object", async () => {
    const m = createFetchMock().on("GET", `${API}/defaultsettings`, { json: { network: "mainnet" } });
    const backend = createPackageBackend({ apiUrl: API, backend: kind }, { fetch: m.fetch });
    expect(await backend.getDefaultSettings()).toEqual({ network: "mainnet" });
  });

  it("saveSettings POSTs the whole object as JSON", async () => {
    const m = createFetchMock().on("POST", `${API}/settings`, { text: "Saved settings and restarted" });
    const backend = createPackageBackend({ apiUrl: API, backend: kind }, { fetch: m.fetch });
    await backend.saveSettings(SETTINGS);
    expect(m.calls[0].body).toEqual(SETTINGS);
    expect(m.calls[0].headers["content-type"]).toBe("application/json");
  });

  it("saveSettings surfaces the deno 422", async () => {
    const m = createFetchMock().on("POST", `${API}/settings`, { status: 422, text: "" });
    const backend = createPackageBackend({ apiUrl: API, backend: kind }, { fetch: m.fetch });
    await expect(backend.saveSettings(SETTINGS)).rejects.toMatchObject({ kind: "http", status: 422 });
  });

  it.each(["start", "stop", "restart"] as const)("service(%s) POSTs /service/%s", async (action) => {
    const m = createFetchMock().on("POST", `${API}/service/${action}`, kind === "monitor" ? { json: "done" } : { text: "done" });
    const backend = createPackageBackend({ apiUrl: API, backend: kind }, { fetch: m.fetch });
    await backend.service(action);
    expect(m.calls).toHaveLength(1);
  });

  it("service treats a 'failed' body as an error, even with HTTP 200 (Prysm monitor start/stop)", async () => {
    const m = createFetchMock()
      .on("POST", `${API}/service/stop`, kind === "monitor" ? { status: 200, json: "failed" } : { status: 200, text: "failed" })
      .on("POST", `${API}/service/restart`, { status: 500, text: "failed" });
    const backend = createPackageBackend({ apiUrl: API, backend: kind }, { fetch: m.fetch });
    await expect(backend.service("stop")).rejects.toMatchObject({ kind: "http", status: 200, detail: "failed" });
    await expect(backend.service("restart")).rejects.toMatchObject({ kind: "http", status: 500 });
  });

  it("serviceStatus returns the supervisord process list", async () => {
    const m = createFetchMock().on("GET", `${API}/service/status`, { json: PROCESSES });
    const backend = createPackageBackend({ apiUrl: API, backend: kind }, { fetch: m.fetch });
    expect(await backend.serviceStatus()).toEqual(PROCESSES);
  });

  it("serviceStatus rejects a non-list", async () => {
    const m = createFetchMock().on("GET", `${API}/service/status`, { json: { nope: 1 } });
    const backend = createPackageBackend({ apiUrl: API, backend: kind }, { fetch: m.fetch });
    await expect(backend.serviceStatus()).rejects.toMatchObject({ kind: "invalid" });
  });

  it("a backend that is down gives 'unreachable'", async () => {
    const m = createFetchMock().on("GET", `${API}/settings`, networkDown());
    const backend = createPackageBackend({ apiUrl: API, backend: kind }, { fetch: m.fetch });
    await expect(backend.getSettings()).rejects.toMatchObject({ kind: "unreachable", service: "backend" });
  });
});

describe("createPackageBackend URL handling", () => {
  it("tolerates a trailing slash on apiUrl", async () => {
    const m = createFetchMock().on("GET", `${API}/settings`, { json: {} });
    const backend = createPackageBackend({ apiUrl: `${API}/`, backend: "deno" }, { fetch: m.fetch });
    expect(await backend.getSettings()).toEqual({});
  });
});
