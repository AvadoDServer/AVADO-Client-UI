import { createFetchMock } from "../../../../api/__tests__/fetchMock";
import { parseAvadoStatus } from "../avado";
import { RpApiError, plainError } from "../errors";
import { SCENARIOS } from "../fixtures";
import { createMockRocketpoolApi, OFF_CHAIN_ROUTES } from "../mock";
import { ARCHIVE_CONFIRMATION } from "../models";
import { createRealRocketpoolApi } from "../real";
import { getBondRequirement } from "../sn";

describe("the old recovery-phrase file (backend archive endpoint)", () => {
  it("real: POSTs {confirm} as JSON with X-Avado-Request: 1 and returns the backup's name", async () => {
    const f = createFetchMock().on("POST", "/api/avado/legacy-mnemonic/archive", {
      status: 200,
      json: { status: "success", error: "", archived: true, name: "mnemonic-archive-20260923T101500Z" },
    });
    const res = await createRealRocketpoolApi(f.fetch).archiveLegacyMnemonic(ARCHIVE_CONFIRMATION);
    expect(res).toMatchObject({ archived: true, name: "mnemonic-archive-20260923T101500Z" });
    expect(f.calls[0].headers["x-avado-request"]).toBe("1");
    expect(f.calls[0].headers["content-type"]).toBe("application/json");
    expect(f.calls[0].body).toEqual({ confirm: "ARCHIVE" });
  });

  it("real: an older backend without the endpoint gives its 404 in plain words", async () => {
    const f = createFetchMock().on("POST", "/api/avado/legacy-mnemonic/archive", { status: 404, json: { status: "error", error: "Not found" } });
    const e = await createRealRocketpoolApi(f.fetch).archiveLegacyMnemonic("ARCHIVE").catch((x: RpApiError) => x);
    expect(e).toMatchObject({ kind: "http", status: 404 });
    expect(plainError(e)).toBe("This version of the Rocket Pool package can't do this yet. Update the package in the AVADO Admin and try again.");
  });

  it("mock: the backend's checks; afterwards the file is no longer reported and the backup is listed", async () => {
    const api = createMockRocketpoolApi({ scenario: "mixed" });
    await expect(api.archiveLegacyMnemonic("archive")).rejects.toMatchObject({ status: 400 });
    expect((await api.avadoStatus()).legacyMnemonicPresent).toBe(true);
    expect(await api.archiveLegacyMnemonic("ARCHIVE")).toMatchObject({ name: "mnemonic-archive-20260923T101500Z" });
    const after = await api.avadoStatus();
    expect(after.legacyMnemonicPresent).toBe(false);
    expect(after.backups[0]).toMatchObject({ name: "mnemonic-archive-20260923T101500Z", kind: "mnemonic-archive" });
    await expect(api.archiveLegacyMnemonic("ARCHIVE")).rejects.toMatchObject({ status: 404 });
    await expect(createMockRocketpoolApi({ scenario: "minipool" }).archiveLegacyMnemonic("ARCHIVE")).rejects.toMatchObject({ status: 404 });
  });
});

describe("backup kinds in the status", () => {
  it("keeps the backend's kinds (mnemonic-archive, wallet-create, manual too); anything else reads as an upgrade backup", () => {
    const status = parseAvadoStatus({
      daemon: { state: "RUNNING" },
      backups: [
        { name: "mnemonic-archive-20260923T101500Z", createdAt: "2026-09-23T10:15:00Z", kind: "mnemonic-archive" },
        { name: "20260920T120000Z-before-wallet-change", createdAt: "", kind: "wallet-change" },
        { name: "1.0.0-20260921T090000Z", createdAt: "", kind: "upgrade" },
        { name: "20260923T101500Z-after-wallet-create", createdAt: "", kind: "wallet-create" },
        { name: "20260923T103000Z-manual-download", createdAt: "", kind: "manual" },
        { name: "odd", createdAt: "", kind: "something-new" },
      ],
    })!;
    expect(status.backups.map((b) => b.kind)).toEqual(["mnemonic-archive", "wallet-change", "upgrade", "wallet-create", "manual", "upgrade"]);
  });
});

describe("status settings", () => {
  it("reads the daemon's gas settings when the backend reports them, plain decimals only", () => {
    const base = { daemon: { state: "RUNNING" } };
    expect(parseAvadoStatus(base)!.settings).toBeUndefined();
    expect(parseAvadoStatus({ ...base, settings: { autoTxGasThreshold: "20", distributeThreshold: 1, priorityFee: "0.01", manualMaxFee: "x" } })!.settings).toEqual({
      autoTxGasThreshold: "20",
      distributeThreshold: "1",
      priorityFee: "0.01",
    });
    expect(parseAvadoStatus({ ...base, settings: { autoTxGasThreshold: "<script>" } })!.settings).toBeUndefined();
  });
});

describe("mock additions", () => {
  it("exits are signed messages: no tx hash", async () => {
    const api = createMockRocketpoolApi({ scenario: "minipool" });
    for (const route of OFF_CHAIN_ROUTES) expect(await api.snPost(route, {})).toEqual({ status: "success", error: "" });
  });

  it("answers the bond requirement per validator count", async () => {
    const api = createMockRocketpoolApi({ scenario: "mixed" });
    expect((await getBondRequirement(api, 2)).bondRequirement).toBe("8000000000000000000");
    expect((await getBondRequirement(api, 3)).bondRequirement).toBe("12000000000000000000");
  });

  it("the exits node has the states the screens need", () => {
    const r = SCENARIOS.exits.reads;
    expect((r["megapool/status"] as { megapoolDetails: { validators: Array<{ exiting: boolean; locked: boolean; inQueue: boolean }> } }).megapoolDetails.validators.map((v) => [v.exiting, v.locked, v.inQueue])).toEqual([
      [false, false, false],
      [true, false, false],
      [false, true, false],
      [false, false, true],
    ]);
    expect(SCENARIOS.exits.avado.settings?.autoTxGasThreshold).toBe("20");
  });
});
