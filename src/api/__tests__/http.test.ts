import { ApiError, isClientUnavailable } from "../errors";
import { createHttp } from "../http";
import { createFetchMock, networkDown } from "./fetchMock";

const BASE = "http://nimbus.my.ava.do:9999";

describe("createHttp", () => {
  it("GETs JSON without a Content-Type (no CORS preflight) and parses the body", async () => {
    const m = createFetchMock().on("GET", `${BASE}/settings`, { json: { a: 1 } });
    const http = createHttp({ baseUrl: BASE, service: "backend", fetch: m.fetch });
    const res = await http.request("/settings");
    expect(res).toEqual({ status: 200, data: { a: 1 } });
    expect(m.calls[0].headers["content-type"]).toBeUndefined();
    expect(m.calls[0].headers["accept"]).toBe("application/json");
  });

  it("keeps a non-JSON body as text and an empty body as undefined", async () => {
    const m = createFetchMock()
      .on("POST", `${BASE}/service/stop`, { text: "stopped" })
      .on("GET", `${BASE}/empty`, { text: "" });
    const http = createHttp({ baseUrl: BASE, service: "backend", fetch: m.fetch });
    expect((await http.request("/service/stop", { method: "POST" })).data).toBe("stopped");
    expect((await http.request("/empty")).data).toBeUndefined();
  });

  it("sends a JSON body with Content-Type application/json", async () => {
    const m = createFetchMock().on("POST", `${BASE}/settings`, { text: "Saved settings and restarted" });
    const http = createHttp({ baseUrl: BASE, service: "backend", fetch: m.fetch });
    await http.request("/settings", { method: "POST", body: { x: "y" } });
    expect(m.calls[0].headers["content-type"]).toBe("application/json");
    expect(m.calls[0].rawBody).toBe('{"x":"y"}');
  });

  it("through a proxy, a POST/DELETE without a body sends {} (the deno proxy JSON-parses every non-GET body)", async () => {
    const m = createFetchMock()
      .on("POST", `${BASE}/keymanager/x`, { json: { data: {} } })
      .on("DELETE", `${BASE}/keymanager/x`, { status: 204 })
      .on("GET", `${BASE}/keymanager/x`, { json: { data: {} } });
    const http = createHttp({ baseUrl: `${BASE}/keymanager`, service: "keymanager", fetch: m.fetch, proxied: true });
    await http.request("/x", { method: "POST" });
    await http.request("/x", { method: "DELETE" });
    await http.request("/x");
    expect(m.calls[0]).toMatchObject({ rawBody: "{}", headers: expect.objectContaining({ "content-type": "application/json" }) });
    expect(m.calls[1]).toMatchObject({ rawBody: "{}", headers: expect.objectContaining({ "content-type": "application/json" }) });
    // GET stays bodiless and without Content-Type (no CORS preflight).
    expect(m.calls[2].rawBody).toBeUndefined();
    expect(m.calls[2].headers["content-type"]).toBeUndefined();
  });

  it("outside a proxy, a POST without a body stays bodiless (the /service routes ignore it)", async () => {
    const m = createFetchMock().on("POST", `${BASE}/service/stop`, { text: "stopped" });
    const http = createHttp({ baseUrl: BASE, service: "backend", fetch: m.fetch });
    await http.request("/service/stop", { method: "POST" });
    expect(m.calls[0].rawBody).toBeUndefined();
  });

  it("a network failure is an 'unreachable' ApiError", async () => {
    const m = createFetchMock().on("GET", `${BASE}/settings`, networkDown());
    const http = createHttp({ baseUrl: BASE, service: "backend", fetch: m.fetch });
    const err = await http.request("/settings").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: "unreachable", service: "backend", path: "/settings" });
    expect(isClientUnavailable(err)).toBe(true);
  });

  it("an error status is an 'http' ApiError carrying the server's message", async () => {
    const m = createFetchMock().on("GET", `${BASE}/rest/eth/v1/x`, { status: 400, json: { code: 400, message: "bad pubkey" } });
    const http = createHttp({ baseUrl: `${BASE}/rest`, service: "beacon", fetch: m.fetch, proxied: true });
    const err = await http.request("/eth/v1/x").catch((e) => e);
    expect(err).toMatchObject({ kind: "http", status: 400, detail: "bad pubkey", service: "beacon" });
    expect(isClientUnavailable(err)).toBe(false);
  });

  it("through a proxy, a 5xx without a client error body means the client is not answering ('upstream')", async () => {
    const m = createFetchMock()
      // Nimbus deno proxy: fetch to localhost:5052 failed
      .on("GET", `${BASE}/keymanager/deno`, { status: 500, json: { error: "Connection refused (os error 111)" } })
      // Teku/Prysm monitor proxy: axios error without a response
      .on("GET", `${BASE}/keymanager/monitor`, { status: 500, json: "connect ECONNREFUSED 127.0.0.1:5052" })
      // The client itself answered 500 with a keymanager error body: a real error
      .on("GET", `${BASE}/keymanager/client`, { status: 500, json: { message: "internal error" } });
    const http = createHttp({ baseUrl: `${BASE}/keymanager`, service: "keymanager", fetch: m.fetch, proxied: true });
    await expect(http.request("/deno")).rejects.toMatchObject({ kind: "upstream", status: 500, detail: "Connection refused (os error 111)" });
    await expect(http.request("/monitor")).rejects.toMatchObject({ kind: "upstream", detail: "connect ECONNREFUSED 127.0.0.1:5052" });
    await expect(http.request("/client")).rejects.toMatchObject({ kind: "http", status: 500, detail: "internal error" });
  });

  it("without a proxy, a 5xx stays an 'http' error", async () => {
    const m = createFetchMock().on("POST", `${BASE}/service/restart`, { status: 500, text: "failed" });
    const http = createHttp({ baseUrl: BASE, service: "backend", fetch: m.fetch });
    await expect(http.request("/service/restart", { method: "POST" })).rejects.toMatchObject({ kind: "http", status: 500, detail: "failed" });
  });

  it("returns chosen error statuses instead of throwing", async () => {
    const m = createFetchMock().on("GET", `${BASE}/rest/v`, { status: 404, json: { code: 404, message: "not found" } });
    const http = createHttp({ baseUrl: `${BASE}/rest`, service: "beacon", fetch: m.fetch, proxied: true });
    expect(await http.request("/v", { accept: (s) => s === 404 })).toEqual({ status: 404, data: { code: 404, message: "not found" } });
  });

  it("times out with a 'timeout' ApiError", async () => {
    vi.useFakeTimers();
    try {
      const m = createFetchMock().on("GET", `${BASE}/slow`, "hang");
      const http = createHttp({ baseUrl: BASE, service: "backend", fetch: m.fetch, timeoutMs: 1000 });
      const p = http.request("/slow").catch((e) => e);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await p).toMatchObject({ kind: "timeout", path: "/slow" });
    } finally {
      vi.useRealTimers();
    }
  });
});
