import { createFetchMock } from "../../../../api/__tests__/fetchMock";
import { parseAvadoStatus } from "../avado";
import { RpApiError, plainError } from "../errors";
import { DEMO, SCENARIOS } from "../fixtures";
import { FOUND_WALLET_GONE, WALLET_ALREADY_THERE, createMockRocketpoolApi } from "../mock";
import { getWalletStatus } from "../sn";
import { createRealRocketpoolApi } from "../real";

const BACKUP_DIR = "backups/legacy-20261006T200006Z";

describe("a wallet found elsewhere on the AVADO (backend adopt endpoint)", () => {
  it("real: POSTs {dir} as JSON with X-Avado-Request: 1 and returns what was copied", async () => {
    const f = createFetchMock().on("POST", "/api/avado/wallet/adopt", {
      status: 200,
      json: { status: "success", error: "", dir: BACKUP_DIR, copied: ["wallet", "password", "validators"], restarted: true },
    });
    const res = await createRealRocketpoolApi(f.fetch).adoptFoundWallet(BACKUP_DIR);
    expect(res).toMatchObject({ dir: BACKUP_DIR, copied: ["wallet", "password", "validators"], restarted: true });
    expect(f.calls[0].headers["x-avado-request"]).toBe("1");
    expect(f.calls[0].headers["content-type"]).toBe("application/json");
    expect(f.calls[0].body).toEqual({ dir: BACKUP_DIR });
  });

  it("real: the backend's refusals keep their plain message", async () => {
    const f = createFetchMock().on("POST", "/api/avado/wallet/adopt", {
      status: 409,
      json: { status: "error", error: "This AVADO already has a Rocket Pool wallet. Nothing was changed." },
    });
    const e = await createRealRocketpoolApi(f.fetch).adoptFoundWallet("").catch((x: RpApiError) => x);
    expect(e).toMatchObject({ kind: "http", status: 409 });
    expect(plainError(e)).toBe("This AVADO already has a Rocket Pool wallet. Nothing was changed.");
  });

  it("mock: refuses a folder that is not on the list (400), and refuses once the wallet is there (409)", async () => {
    const api = createMockRocketpoolApi({ scenario: "wallet-found" });
    await expect(api.adoptFoundWallet("somewhere-else")).rejects.toMatchObject({ kind: "http", status: 400, detail: FOUND_WALLET_GONE });
    expect((await api.avadoStatus()).walletFilePresent).toBe(false);
    await expect(createMockRocketpoolApi({ scenario: "minipool" }).adoptFoundWallet(BACKUP_DIR)).rejects.toMatchObject({ status: 409, detail: WALLET_ALREADY_THERE });
  });

  it("mock: after a success the wallet is present, nothing more is found, and Smartnode reads it", async () => {
    const api = createMockRocketpoolApi({ scenario: "wallet-found" });
    const before = await api.avadoStatus();
    expect(before.foundWallets?.map((w) => w.dir)).toEqual([BACKUP_DIR, "data-old"]);
    expect((await getWalletStatus(api)).walletInitialized).toBe(false);

    const res = await api.adoptFoundWallet(BACKUP_DIR);
    expect(res).toMatchObject({ status: "success", dir: BACKUP_DIR, restarted: true });
    expect(res.copied).toContain("wallet");
    expect(api.calls.at(-1)).toEqual({ method: "POST", path: "/api/avado/wallet/adopt", params: { dir: BACKUP_DIR } });

    const after = await api.avadoStatus();
    expect(after.walletFilePresent).toBe(true);
    expect(after.passwordFilePresent).toBe(true);
    expect(after.foundWallets).toEqual([]);
    const wallet = await getWalletStatus(api);
    expect(wallet.walletInitialized).toBe(true);
    expect(wallet.accountAddress).toBe(DEMO.nodeAddress);
    await expect(api.adoptFoundWallet("data-old")).rejects.toMatchObject({ status: 409 });
  });

  it("status: the found wallets are read defensively; an older backend sends none", () => {
    const status = parseAvadoStatus({
      daemon: { state: "RUNNING" },
      walletFilePresent: false,
      foundWallets: [
        { dir: BACKUP_DIR, address: DEMO.nodeAddress, modifiedAt: "2026-10-06T20:00:06Z", hasValidators: true, source: "backup" },
        { dir: "", address: null, modifiedAt: "2026-09-01T10:00:00Z", hasValidators: false, source: "other" },
        { dir: "odd", address: 42, modifiedAt: null, hasValidators: "yes", source: "something-new" },
        { address: DEMO.nodeAddress },
        "not an object",
      ],
    })!;
    expect(status.foundWallets).toEqual([
      { dir: BACKUP_DIR, address: DEMO.nodeAddress, modifiedAt: "2026-10-06T20:00:06Z", hasValidators: true, source: "backup" },
      { dir: "", address: null, modifiedAt: "2026-09-01T10:00:00Z", hasValidators: false, source: "other" },
      { dir: "odd", address: null, modifiedAt: "", hasValidators: false, source: "other" },
    ]);
    expect(parseAvadoStatus({ daemon: { state: "RUNNING" } })!.foundWallets).toBeUndefined();
    expect(SCENARIOS["wallet-found"].avado.walletFilePresent).toBe(false);
  });
});
