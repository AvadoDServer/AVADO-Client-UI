import { render, screen } from "@testing-library/react";
import { createFetchMock, networkDown } from "../../../../api/__tests__/fetchMock";
import { RpApiError, isOutcomeUnknown, isTxReverted, plainError } from "../errors";
import { createMockRocketpoolApi } from "../mock";
import {
  AVADO_REQUEST_HEADER,
  LONG_TIMEOUT_MS,
  READ_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
  createRealRocketpoolApi,
} from "../real";
import { RocketpoolApiProvider, createRocketpoolApi, isMock, useRocketpoolApi } from "../RocketpoolApiProvider";
import { EXPORT_CONFIRMATION, exportWallet, getGasPrice, getMegapoolStatus, getNodeStatus, waitForTx } from "../sn";

const ok = (body: Record<string, unknown> = {}) => ({ json: { status: "success", error: "", ...body } });
const HASH = `0x${"12".repeat(32)}`;

async function caught(p: Promise<unknown>): Promise<RpApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RpApiError) return e;
    throw e;
  }
  throw new Error("expected a rejection");
}

describe("real Rocket Pool API", () => {
  it("reads Smartnode routes with a GET on the same origin, parameters in the query, no CSRF header", async () => {
    const f = createFetchMock().on("GET", "/api/sn/node/can-deposit?amountWei=4000000000000000000&count=1&minFee=0", ok({ canDeposit: true }));
    const api = createRealRocketpoolApi(f.fetch);
    const res = await api.snGet<{ status: "success"; error: string; canDeposit: boolean }>("node/can-deposit", {
      amountWei: "4000000000000000000",
      count: 1,
      minFee: 0,
    });
    expect(res.canDeposit).toBe(true);
    expect(f.calls[0].headers).toEqual({ accept: "application/json" });
    expect(f.calls[0].body).toBeUndefined();
  });

  it("sends writes as a POST with X-Avado-Request: 1 and a flat JSON body", async () => {
    const f = createFetchMock().on("POST", "/api/sn/node/distribute", ok({ txHash: HASH }));
    const api = createRealRocketpoolApi(f.fetch);
    const res = await api.snPost("node/distribute", { maxFee: "2.7", maxPrioFee: "1", gasLimit: "217500" });
    expect(res).toMatchObject({ txHash: HASH });
    expect(f.calls[0].headers[AVADO_REQUEST_HEADER.toLowerCase()]).toBe("1");
    expect(f.calls[0].headers["content-type"]).toBe("application/json");
    expect(f.calls[0].body).toEqual({ maxFee: "2.7", maxPrioFee: "1", gasLimit: "217500" });
  });

  it("always sends a JSON body on a POST, also without parameters (reconcile run too)", async () => {
    const f = createFetchMock()
      .on("POST", "/api/sn/wallet/rebuild", ok())
      .on("POST", "/api/avado/reconcile/run", { status: 202, json: { status: "success" } });
    const api = createRealRocketpoolApi(f.fetch);
    await api.snPost("wallet/rebuild");
    await api.requestReconcile();
    expect(f.calls.map((c) => [c.rawBody, c.headers["x-avado-request"]])).toEqual([
      ["{}", "1"],
      ["{}", "1"],
    ]);
  });

  it("reads the AVADO routes without an envelope", async () => {
    const f = createFetchMock()
      .on("GET", "/api/avado/status", { json: { network: "mainnet", daemon: { state: "RUNNING" } } })
      .on("GET", "/api/avado/reconcile", { json: { available: false, runRequested: false } })
      .on("GET", "/api/avado/logs?tail=2000", { json: { available: true, lines: ["a"] } });
    const api = createRealRocketpoolApi(f.fetch);
    expect((await api.avadoStatus()).daemon.state).toBe("RUNNING");
    expect(await api.reconcile()).toEqual({ available: false, runRequested: false });
    expect((await api.logs(99_999)).lines).toEqual(["a"]); // clamped to the backend's maximum
  });

  it("refuses a route that could leave /api/sn/ before any request", async () => {
    const f = createFetchMock();
    const api = createRealRocketpoolApi(f.fetch);
    for (const route of ["../avado/status", "node/../../x", "node/status?x=1", "/node/status", "Node/Status", ""]) {
      expect(() => api.snGet(route)).toThrow(TypeError);
      expect(() => api.snPost(route)).toThrow(TypeError);
    }
    expect(f.calls).toHaveLength(0);
  });

  it("keeps big numbers exact as the backend sends them (strings above 2^53)", async () => {
    const text = '{"status":"success","error":"","accountBalances":{"eth":"32041200000000000000","rpl":6100000000000000}}';
    const f = createFetchMock().on("GET", "/api/sn/node/status", { text });
    const node = await getNodeStatus(createRealRocketpoolApi(f.fetch));
    expect(node.accountBalances.eth).toBe("32041200000000000000");
    expect(node.accountBalances.rpl).toBe(6100000000000000);
  });

  it("maps failures: Smartnode's error text, HTTP statuses, no answer, not JSON", async () => {
    const f = createFetchMock()
      .on("GET", "/api/sn/node/status", {
        status: 500,
        json: { status: "error", error: "The node wallet has not been initialized. Please run 'rocketpool wallet init' and try again." },
      })
      .on("GET", "/api/sn/node/sync", { status: 200, json: { status: "error", error: "EC not synced" } })
      .on("GET", "/api/sn/version", { status: 502, json: { status: "error", error: "The Rocket Pool daemon is not reachable (it may still be starting)." } })
      .on("GET", "/api/sn/megapool/status?finalizedState=false", networkDown())
      .on("GET", "/api/sn/minipool/status", { status: 200, text: "<html>proxy</html>" })
      .on("POST", "/api/sn/wallet/init", {
        status: 409,
        json: { status: "error", error: "This AVADO already has a Rocket Pool wallet. Contact support@ava.do if you need to change it." },
      });
    const api = createRealRocketpoolApi(f.fetch);

    const noWallet = await caught(api.snGet("node/status"));
    expect(noWallet).toMatchObject({ kind: "http", status: 500 });
    expect(plainError(noWallet)).toBe("The node wallet has not been initialized.");

    const envelope = await caught(api.snGet("node/sync"));
    expect(envelope).toMatchObject({ kind: "smartnode", detail: "EC not synced" });
    expect(plainError(envelope)).toBe("EC not synced.");

    const down = await caught(api.snGet("version"));
    expect(down).toMatchObject({ kind: "http", status: 502 });
    expect(plainError(down)).toBe("The Rocket Pool daemon is not reachable (it may still be starting).");

    const unreachable = await caught(getMegapoolStatus(api));
    expect(unreachable.kind).toBe("unreachable");
    expect(plainError(unreachable)).toMatch(/not answering/);

    expect((await caught(api.snGet("minipool/status"))).kind).toBe("invalid");

    const exists = await caught(api.snPost("wallet/init", { derivationPath: "" }));
    expect(exists.status).toBe(409);
    expect(plainError(exists)).toBe("This AVADO already has a Rocket Pool wallet. Contact support@ava.do if you need to change it.");
  });

  it("gives up after its time limit: 60 s for reads, 150 s for writes, 65 min for wait and wallet recovery", async () => {
    vi.useFakeTimers();
    try {
      const f = createFetchMock()
        .on("GET", "/api/sn/node/status", "hang")
        .on("POST", "/api/sn/node/distribute", "hang")
        .on("GET", `/api/sn/wait?txHash=${HASH}`, "hang")
        .on("POST", "/api/sn/wallet/recover", "hang");
      const api = createRealRocketpoolApi(f.fetch);
      const settled: Record<string, RpApiError | "pending"> = { read: "pending", write: "pending", wait: "pending", recover: "pending" };
      const track = (name: string, p: Promise<unknown>) =>
        p.catch((e: RpApiError) => {
          settled[name] = e;
        });
      void track("read", api.snGet("node/status"));
      void track("write", api.snPost("node/distribute"));
      void track("wait", waitForTx(api, HASH));
      void track("recover", api.snPost("wallet/recover", { mnemonic: "x" }));

      await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
      expect(settled.read).toMatchObject({ kind: "timeout" });
      expect(settled.write).toBe("pending");
      await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS - READ_TIMEOUT_MS);
      expect(settled.write).toMatchObject({ kind: "timeout" });
      expect(settled.wait).toBe("pending");
      expect(settled.recover).toBe("pending");
      await vi.advanceTimersByTimeAsync(LONG_TIMEOUT_MS - WRITE_TIMEOUT_MS);
      expect(settled.wait).toMatchObject({ kind: "timeout" });
      expect(settled.recover).toMatchObject({ kind: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads the status defensively: cautious defaults for missing fields, invalid for a non-object", async () => {
    const f = createFetchMock()
      .once("GET", "/api/avado/status", { json: { daemon: "broken", backups: [{ name: 5 }, { name: "b", kind: "odd" }], daemonErrors: ["x", 3] } })
      .once("GET", "/api/avado/status", { json: [1, 2] });
    const api = createRealRocketpoolApi(f.fetch);
    expect(await api.avadoStatus()).toMatchObject({
      daemon: { state: "UNKNOWN" },
      apiReachable: false,
      apiTokenPresent: false,
      networkSupported: true,
      walletFilePresent: true,
      passwordFilePresent: true,
      legacyMnemonicPresent: false,
      startupError: null,
      daemonErrors: ["x"],
      backups: [{ name: "b", createdAt: "", kind: "upgrade" }],
    });
    expect((await caught(api.avadoStatus())).kind).toBe("invalid");
  });

  it("a caller can cancel a request (a wait no longer needed)", async () => {
    const f = createFetchMock().on("GET", `/api/sn/wait?txHash=${HASH}`, "hang");
    const api = createRealRocketpoolApi(f.fetch);
    const controller = new AbortController();
    const p = waitForTx(api, HASH, { signal: controller.signal });
    controller.abort();
    expect((await caught(p)).kind).toBe("aborted");
    expect((await caught(waitForTx(api, HASH, { signal: controller.signal }))).kind).toBe("aborted"); // already aborted: no request
    expect(f.calls).toHaveLength(1);
  });

  it("typed helpers: gas price, wait (hash checked first), wallet export with the typed confirmation", async () => {
    const f = createFetchMock()
      .on("GET", "/api/sn/service/get-gas-price-from-latest-block", ok({ gasPrice: 850000000 }))
      .on("GET", `/api/sn/wait?txHash=${HASH}`, ok())
      .on("POST", "/api/sn/wallet/export", ok({ password: "p", wallet: "w", accountPrivateKey: "k" }));
    const api = createRealRocketpoolApi(f.fetch);
    expect((await getGasPrice(api)).gasPrice).toBe(850000000);
    await waitForTx(api, HASH);
    await expect(waitForTx(api, "0xnot-a-hash")).rejects.toThrow(TypeError);
    await exportWallet(api, EXPORT_CONFIRMATION);
    expect(f.calls.at(-1)?.body).toEqual({ typedConfirmation: "EXPORT" });
    expect(f.calls.filter((c) => c.url.includes("not-a-hash"))).toHaveLength(0);
  });
});

describe("error meaning", () => {
  const err = (init: ConstructorParameters<typeof RpApiError>[0]) => new RpApiError(init);

  it("a write with no clear answer may have been sent; a refusal was not", () => {
    expect(isOutcomeUnknown(err({ kind: "unreachable", path: "p" }))).toBe(true);
    expect(isOutcomeUnknown(err({ kind: "timeout", path: "p" }))).toBe(true);
    expect(isOutcomeUnknown(err({ kind: "http", path: "p", status: 504 }))).toBe(true);
    expect(isOutcomeUnknown(err({ kind: "http", path: "p", status: 502 }))).toBe(true);
    expect(isOutcomeUnknown(new Error("bug"))).toBe(true);
    expect(isOutcomeUnknown(err({ kind: "http", path: "p", status: 500, detail: "insufficient balance" }))).toBe(false);
    expect(isOutcomeUnknown(err({ kind: "http", path: "p", status: 403 }))).toBe(false);
    expect(isOutcomeUnknown(err({ kind: "smartnode", path: "p", detail: "no" }))).toBe(false);
  });

  it("a wait failed only when Smartnode says the tx failed", () => {
    expect(isTxReverted(err({ kind: "http", path: "p", status: 500, detail: "Transaction failed with status 0" }))).toBe(true);
    expect(isTxReverted(err({ kind: "http", path: "p", status: 500, detail: "dial tcp 1.2.3.4: connection refused" }))).toBe(false);
    expect(isTxReverted(err({ kind: "timeout", path: "p" }))).toBe(false);
  });
});

describe("wiring", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("uses the demo node under VITE_MOCK=1, chosen by ?scenario=, and never the network", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(isMock()).toBe(true);
    window.history.replaceState(null, "", "/?scenario=daemon-failed");
    expect((await createRocketpoolApi().avadoStatus()).daemon.state).toBe("FATAL");
    window.history.replaceState(null, "", "/?scenario=nonsense");
    expect((await createRocketpoolApi().avadoStatus()).legacyMnemonicPresent).toBe(true); // the default: mixed
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("without mocks, uses the real adapters", async () => {
    vi.stubEnv("VITE_MOCK", "");
    const fetchSpy = vi.fn(async () => new Response('{"daemon":{"state":"RUNNING"}}', { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(isMock()).toBe(false);
    await createRocketpoolApi().avadoStatus();
    expect(fetchSpy).toHaveBeenCalledWith("/api/avado/status", expect.objectContaining({ method: "GET" }));
  });

  it("provides the given adapters, and refuses use outside the provider", () => {
    const api = createMockRocketpoolApi();
    function Probe() {
      return <span>{useRocketpoolApi() === api ? "same" : "different"}</span>;
    }
    render(
      <RocketpoolApiProvider api={api}>
        <Probe />
      </RocketpoolApiProvider>,
    );
    expect(screen.getByText("same")).toBeInTheDocument();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow("useRocketpoolApi() must be used inside <RocketpoolApiProvider>");
    spy.mockRestore();
  });
});
