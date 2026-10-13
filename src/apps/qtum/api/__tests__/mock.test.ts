import { MOCK_SCENARIOS, SCENARIOS } from "../fixtures";
import { createMockQtumApi, scenarioFromEnvironment } from "../mock";
import { readNodeInfo } from "../node";

describe("the demo package", () => {
  it("every scenario answers the wallet status and the settings", async () => {
    for (const scenario of MOCK_SCENARIOS) {
      const api = createMockQtumApi({ scenario });
      expect((await api.walletStatus()).state).toBe(SCENARIOS[scenario]().walletStatus.state);
      expect(await api.settings()).toHaveProperty("BACKUP_REQUIRED");
    }
  });

  it("the scenario comes from the address, else staking", () => {
    expect(scenarioFromEnvironment("?scenario=locked")).toBe("locked");
    expect(scenarioFromEnvironment("?scenario=nope")).toBe("staking");
  });

  it("the node starts (-28) in fresh and is down while restoring", async () => {
    await expect(readNodeInfo(createMockQtumApi({ scenario: "fresh" }))).rejects.toMatchObject({ kind: "rpc", code: -28 });
    await expect(readNodeInfo(createMockQtumApi({ scenario: "restoring" }))).rejects.toMatchObject({ kind: "http", status: 502 });
  });

  it("wallet tasks finish by themselves with settleMs", async () => {
    vi.useFakeTimers();
    try {
      const api = createMockQtumApi({ scenario: "upgrade-failed", settleMs: 1000 });
      await api.rebuildWallet();
      expect((await api.walletStatus()).state).toBe("rebuilding");
      await vi.advanceTimersByTimeAsync(1000);
      const s = await api.walletStatus();
      expect(s).toMatchObject({ state: "ready", newBackupRequired: true, migration: { method: "rebuild", state: "done" } });
    } finally {
      vi.useRealTimers();
    }
  });
});
