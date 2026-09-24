import { RpApiError } from "../errors";
import { DEMO, MOCK_SCENARIOS, SCENARIOS, eth } from "../fixtures";
import { WALLET_EXISTS_MESSAGE, canFlag, createMockRocketpoolApi, txHashField } from "../mock";
import type { MegapoolStatusResponse, MinipoolStatusResponse, NodeStatus, WalletStatus } from "../models";
import { getGasPrice, getMegapoolStatus, getMinipoolStatus, getNodeStatus, getWalletStatus, waitForTx } from "../sn";
import { toBigInt } from "../../lib/units";

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Every big integer in the wire format: a safe-integer number, or a string of digits above 2^53. */
function wireIssues(value: unknown, path = ""): string[] {
  if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) return [`${path}: unsafe number`];
  if (typeof value === "string" && /^\d{16,}$/.test(value) && BigInt(value) <= MAX_SAFE) return [`${path}: small value as string`];
  if (Array.isArray(value)) return value.flatMap((v, i) => wireIssues(v, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => wireIssues(v, `${path}.${k}`));
  return [];
}

async function rejection(p: Promise<unknown>): Promise<RpApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RpApiError) return e;
    throw e;
  }
  throw new Error("expected a rejection");
}

describe("demo fixtures", () => {
  it("has the five nodes", () => {
    expect([...MOCK_SCENARIOS]).toEqual(["minipool", "mixed", "fresh", "daemon-failed", "exits"]);
    for (const name of MOCK_SCENARIOS) expect(SCENARIOS[name].name).toBe(name);
  });

  it("uses the backend's wire format for big integers", () => {
    expect(eth("1")).toBe("1000000000000000000");
    expect(eth("0.0061")).toBe(6_100_000_000_000_000);
    for (const s of MOCK_SCENARIOS) expect(wireIssues(SCENARIOS[s])).toEqual([]);
  });

  it("minipool node: two staking minipools, no megapool, smoothing pool, cold withdrawal address", async () => {
    const api = createMockRocketpoolApi({ scenario: "minipool" });
    const node = await getNodeStatus(api);
    expect(node.registered).toBe(true);
    expect(node.minipoolCounts.staking).toBe(2);
    expect(node.megapoolDeployed).toBe(false);
    expect(node.feeRecipientInfo.isInSmoothingPool).toBe(true);
    expect(node.primaryWithdrawalAddress).toBe(DEMO.coldWallet);
    expect((await getMinipoolStatus(api)).minipools.map((m) => m.status.status)).toEqual(["Staking", "Staking"]);
    expect((await getMegapoolStatus(api)).megapoolDetails.validators).toEqual([]);
  });

  it("mixed node: one minipool plus a megapool with an active and a queued validator", async () => {
    const api = createMockRocketpoolApi({ scenario: "mixed" });
    const node: NodeStatus = await getNodeStatus(api);
    expect(node.minipoolCounts.total).toBe(1);
    expect(node.megapoolDeployed).toBe(true);
    expect(node.feeRecipientInfo).toMatchObject({ hasMinipools: true, hasMegapoolValidators: true, isInSmoothingPool: false });
    expect(node.primaryWithdrawalAddress).toBe(node.accountAddress); // still the hot wallet
    expect(toBigInt(node.accountBalances.eth)! < 10n ** 16n).toBe(true); // low on gas
    const mega: MegapoolStatusResponse = await getMegapoolStatus(api);
    expect(mega.megapoolDetails.validators.map((v) => [v.staked, v.inQueue])).toEqual([
      [true, false],
      [false, true],
    ]);
    const minipools: MinipoolStatusResponse = await getMinipoolStatus(api);
    expect(minipools.minipools).toHaveLength(1);
  });

  it("fresh node: daemon running, no wallet; node reads fail like Smartnode's", async () => {
    const api = createMockRocketpoolApi({ scenario: "fresh" });
    const avado = await api.avadoStatus();
    expect(avado).toMatchObject({ walletFilePresent: false, passwordFilePresent: false, apiReachable: true });
    const wallet: WalletStatus = await getWalletStatus(api);
    expect(wallet.walletInitialized).toBe(false);
    const e = await rejection(getNodeStatus(api));
    expect(e).toMatchObject({ kind: "http", status: 500 });
    expect(e.detail).toMatch(/wallet has not been initialized/);
  });

  it("failed daemon: FATAL with a startup error, and every Smartnode call gets the backend's 502", async () => {
    const api = createMockRocketpoolApi({ scenario: "daemon-failed" });
    const avado = await api.avadoStatus();
    expect(avado.daemon.state).toBe("FATAL");
    expect(avado.apiReachable).toBe(false);
    expect(avado.startupError).toMatch(/could not load its settings/);
    expect(await rejection(getWalletStatus(api))).toMatchObject({ kind: "http", status: 502 });
    expect(await rejection(api.snPost("node/distribute"))).toMatchObject({ kind: "http", status: 502 });
    expect((await api.logs(1)).lines).toHaveLength(1);
  });
});

describe("mock backend", () => {
  it("answers any can-X with 'yes' and a gas estimate, and a write with a tx hash that wait confirms", async () => {
    const api = createMockRocketpoolApi({ scenario: "minipool" });
    const can = await api.snGet("node/can-distribute");
    expect(can).toMatchObject({ status: "success", canDistribute: true, gasLimits: { estimated: 145_000, safe: 217_500 } });
    expect((await getGasPrice(api)).gasPrice).toBe(850_000_000);
    const res = await api.snPost<{ status: "success"; error: string; txHash: string }>("node/distribute", { maxFee: "2.7" });
    expect(res.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    await expect(waitForTx(api, res.txHash)).resolves.toMatchObject({ status: "success" });
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/sn/node/can-distribute",
      "GET /api/sn/service/get-gas-price-from-latest-block",
      "POST /api/sn/node/distribute",
      "GET /api/sn/wait",
    ]);
    expect(api.calls[2].params).toEqual({ maxFee: "2.7" });
  });

  it("names flags and hash fields like Smartnode", () => {
    expect(canFlag("megapool/can-exit-validator")).toBe("canExitValidator");
    expect(canFlag("node/status")).toBeNull();
    expect(txHashField("node/stake-rpl")).toBe("stakeTxHash");
    expect(txHashField("node/stake-rpl-approve-rpl")).toBe("approveTxHash");
    expect(txHashField("node/claim-rewards")).toBe("txHash");
  });

  it("can fail a route, revert a tx, or be down entirely", async () => {
    const reverting = createMockRocketpoolApi({ txOutcome: "revert" });
    const { txHash } = await reverting.snPost<{ status: "success"; error: string; txHash: string }>("node/distribute");
    expect((await rejection(waitForTx(reverting, txHash))).detail).toBe("Transaction failed with status 0");

    const failing = createMockRocketpoolApi({ failures: { "node/distribute": "timeout" } });
    expect((await rejection(failing.snPost("node/distribute"))).kind).toBe("timeout");

    const down = createMockRocketpoolApi({ backendDown: true });
    expect((await rejection(down.avadoStatus())).kind).toBe("unreachable");
  });

  it("applies the backend's wallet guards", async () => {
    const api = createMockRocketpoolApi({ scenario: "minipool" });
    const exists = await rejection(api.snPost("wallet/recover", { mnemonic: "demo" }));
    expect(exists).toMatchObject({ status: 409, detail: WALLET_EXISTS_MESSAGE });
    expect((await rejection(api.snPost("wallet/set-password", { password: "x" }))).status).toBe(409);
    expect((await rejection(api.snPost("wallet/export", { typedConfirmation: "export" }))).status).toBe(400);
    const backup = await api.snPost<{ status: "success"; error: string; wallet: string }>("wallet/export", { typedConfirmation: "EXPORT" });
    expect(backup.wallet).toMatch(/not a real wallet/);

    const fresh = createMockRocketpoolApi({ scenario: "fresh" });
    await expect(fresh.snPost("wallet/set-password", { password: "x" })).resolves.toMatchObject({ status: "success" });
  });

  it("never hands out the fixture objects themselves", async () => {
    const api = createMockRocketpoolApi({ scenario: "minipool" });
    const a = await getNodeStatus(api);
    a.registered = false;
    expect((await getNodeStatus(api)).registered).toBe(true);
  });
});
