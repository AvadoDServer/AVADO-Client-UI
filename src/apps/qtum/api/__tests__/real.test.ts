import { QtumApiError, plainError } from "../errors";
import { backupFileName, createRealQtumApi, WIZARD_HEADER } from "../real";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(String(url), init ?? {});
  }) as typeof fetch;
  return { calls, impl };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const headersOf = (c: Call) => c.init.headers as Record<string, string>;

describe("the real Qtum adapters", () => {
  it("JSON-RPC goes to /rpc, same origin, with the method and params", async () => {
    const f = fakeFetch(() => json({ result: { blocks: 5, headers: 6 }, error: null, id: "x" }));
    const api = createRealQtumApi(f.impl);
    await expect(api.rpc("getblockchaininfo")).resolves.toEqual({ blocks: 5, headers: 6 });
    expect(f.calls[0].url).toBe("/rpc");
    expect(f.calls[0].init.method).toBe("POST");
    expect(f.calls[0].init.credentials).toBe("same-origin");
    expect(headersOf(f.calls[0])["Content-Type"]).toBe("application/json");
    const body = JSON.parse(String(f.calls[0].init.body));
    expect(body).toMatchObject({ jsonrpc: "1.0", method: "getblockchaininfo", params: [] });
  });

  it("an RPC error (HTTP 500 with the error in the body) keeps its code; the password is not in it", async () => {
    const f = fakeFetch(() => json({ result: null, error: { code: -14, message: "Error: The wallet passphrase entered was incorrect." }, id: "x" }, 500));
    const api = createRealQtumApi(f.impl);
    const err = await api.rpc("walletpassphrase", ["secret pw", 99999999, true]).catch((e) => e);
    expect(err).toBeInstanceOf(QtumApiError);
    expect(err).toMatchObject({ kind: "rpc", code: -14, status: 500 });
    expect(String((err as Error).message)).not.toContain("secret pw");
    expect(plainError(err)).toBe("That password is not right. Please check it and try again.");
  });

  it("the node starting (-28) and nginx without the node (502)", async () => {
    const warm = createRealQtumApi(fakeFetch(() => json({ result: null, error: { code: -28, message: "Loading block index…" } }, 500)).impl);
    expect(plainError(await warm.rpc("getblockchaininfo").catch((e) => e))).toBe("The Qtum node is still starting. Please try again in a few minutes.");
    const down = createRealQtumApi(fakeFetch(() => new Response("<html>502 Bad Gateway</html>", { status: 502 })).impl);
    const err = await down.rpc("getblockchaininfo").catch((e) => e);
    expect(err).toMatchObject({ kind: "http", status: 502 });
    expect(plainError(err)).toBe("The Qtum node is not running yet. It may still be starting: try again in a few minutes.");
  });

  it("no answer at all", async () => {
    const api = createRealQtumApi((async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch);
    const err = await api.walletStatus().catch((e) => e);
    expect(err).toMatchObject({ kind: "unreachable", path: "/monitor/walletstatus" });
    expect(plainError(err)).toBe("The Qtum package is not answering. It may be restarting: try again in a minute.");
  });

  it("monitor calls send the wizard header; writes send JSON; refusals carry the monitor's words", async () => {
    const f = fakeFetch((url) =>
      url.endsWith("/setenv") ? json({ error: "The delegation fee must be a whole number from 0 to 100." }, 400) : json({ DELEGATION_FEE_PERCENT: 10, MIN_DELEGATION_AMOUNT: 100, BACKUP_REQUIRED: true }),
    );
    const api = createRealQtumApi(f.impl);
    await expect(api.settings()).resolves.toEqual({ DELEGATION_FEE_PERCENT: 10, MIN_DELEGATION_AMOUNT: 100, BACKUP_REQUIRED: true });
    const err = await api.saveSettings({ DELEGATION_FEE_PERCENT: 120 }).catch((e) => e);
    expect(plainError(err)).toBe("The delegation fee must be a whole number from 0 to 100.");
    expect(f.calls.map((c) => [c.url, c.init.method, headersOf(c)[WIZARD_HEADER]])).toEqual([
      ["/monitor/getenv", "GET", "1"],
      ["/monitor/setenv", "POST", "1"],
    ]);
    expect(JSON.parse(String(f.calls[1].init.body))).toEqual({ DELEGATION_FEE_PERCENT: 120 });
  });

  it("parses the wallet status the monitor sends", async () => {
    const api = createRealQtumApi(
      fakeFetch(() =>
        json({
          state: "failed",
          message: "x",
          problem: null,
          busy: null,
          migration: { state: "failed", method: "upgrade", encrypted: true, canRebuild: true },
          rebuild: { state: "failed", step: null, progress: null, notCarriedOver: "", source: "raw-pages", seedRestored: true },
          newBackupRequired: false,
          import: null,
          restore: { state: "failed", message: "m", at: "t" },
          scanning: false,
        }),
      ).impl,
    );
    const s = await api.walletStatus();
    expect(s.migration).toMatchObject({ state: "failed", encrypted: true, canRebuild: true, failedAt: null });
    expect(s.rebuild).toMatchObject({ source: "raw-pages", seedRestored: true });
    expect(s.restore).toEqual({ state: "failed", message: "m", at: "t" });
  });

  it("downloads a backup file with the monitor's file name; an HTML page is not a backup", async () => {
    const f = fakeFetch(
      () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "Content-Type": "application/octet-stream", "Content-Disposition": 'attachment; filename="qtum-wallet-2026-10-13.dat"' },
        }),
    );
    const api = createRealQtumApi(f.impl);
    const got = await api.downloadBackup();
    expect(got.fileName).toBe("qtum-wallet-2026-10-13.dat");
    expect(got.blob.size).toBe(3);
    expect(f.calls[0].url).toBe("/monitor/backup");
    expect(f.calls[0].init.method).toBe("POST");
    expect(headersOf(f.calls[0])[WIZARD_HEADER]).toBe("1");
    const html = createRealQtumApi(fakeFetch(() => new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } })).impl);
    await expect(html.downloadBackup()).rejects.toMatchObject({ kind: "invalid" });
    const refused = createRealQtumApi(fakeFetch(() => json({ error: "Your wallet is not loaded yet. Please wait a moment and try again." }, 500)).impl);
    await expect(refused.downloadBackup()).rejects.toMatchObject({ kind: "http", status: 500, detail: "Your wallet is not loaded yet. Please wait a moment and try again." });
  });

  it("the backup's file name: only a plain name from the monitor, else the old wizard's", () => {
    const today = new Date("2026-10-13T12:00:00Z");
    expect(backupFileName('attachment; filename="qtum-wallet-2026-10-13.dat"', today)).toBe("qtum-wallet-2026-10-13.dat");
    expect(backupFileName('attachment; filename="../etc/passwd"', today)).toBe("qtum-wallet-2026-10-13.dat");
    expect(backupFileName(null, today)).toBe("qtum-wallet-2026-10-13.dat");
  });

  it("uploads a backup as it is (octet-stream), then restores it by name", async () => {
    const f = fakeFetch((url) => (url.endsWith("/uploadbackup") ? json({ file: "wallet-upload.dat" }) : json({ started: true }, 202)));
    const api = createRealQtumApi(f.impl);
    const file = new Blob([new Uint8Array([9, 9])]);
    const name = await api.uploadBackup(file);
    await api.restoreBackup(name);
    expect(f.calls[0].url).toBe("/monitor/uploadbackup");
    expect(headersOf(f.calls[0])["Content-Type"]).toBe("application/octet-stream");
    expect(f.calls[0].init.body).toBe(file);
    expect(f.calls[1].url).toBe("/monitor/restore");
    expect(JSON.parse(String(f.calls[1].init.body))).toEqual({ file: "wallet-upload.dat" });
  });

  it("the upgrade and the rebuild send the password only when there is one", async () => {
    const f = fakeFetch(() => json({ started: true }, 202));
    const api = createRealQtumApi(f.impl);
    await api.retryUpgrade();
    await api.retryUpgrade("pw");
    await api.rebuildWallet();
    await api.rebuildWallet("pw2");
    expect(f.calls.map((c) => [c.url, JSON.parse(String(c.init.body))])).toEqual([
      ["/monitor/migrate", {}],
      ["/monitor/migrate", { passphrase: "pw" }],
      ["/monitor/rebuild", {}],
      ["/monitor/rebuild", { passphrase: "pw2" }],
    ]);
  });

  it("logs: between 1 and 2000 lines", async () => {
    const f = fakeFetch(() => json({ lines: ["a", "b"] }));
    const api = createRealQtumApi(f.impl);
    await expect(api.logs(5000)).resolves.toEqual(["a", "b"]);
    await api.logs(0);
    expect(f.calls.map((c) => c.url)).toEqual(["/monitor/logs?lines=2000", "/monitor/logs?lines=1"]);
  });

  it("an older monitor without the new routes: update the package", async () => {
    const api = createRealQtumApi(fakeFetch(() => json({ code: "ResourceNotFound", message: "/staking-summary does not exist" }, 404)).impl);
    const err = await api.stakingSummary().catch((e) => e);
    expect(plainError(err)).toBe("This version of the Qtum package can't do this yet. Update the package in the AVADO Admin and try again.");
  });

  it("the private key comes back as it is", async () => {
    const api = createRealQtumApi(fakeFetch(() => json({ address: "Qx", privateKey: "L1abc" })).impl);
    await expect(api.privateKey("Qx")).resolves.toBe("L1abc");
  });
});
