import { isSyncing, qtumVersion, syncPercent, walletSummary } from "../node";
import { createMockQtumApi } from "../mock";
import { addressesMakingOne, listAddresses } from "../node";

describe("node reads", () => {
  it("the Qtum version from the node's subversion", () => {
    // Qtum v30 reports Bitcoin Core's "Satoshi" name.
    expect(qtumVersion("/Satoshi:30.2.0/")).toBe("30.2.0");
    expect(qtumVersion("/Qtum:30.2.0/")).toBe("30.2.0");
    expect(qtumVersion("", 300200)).toBe("30.2.0");
    expect(qtumVersion(undefined)).toBeUndefined();
  });

  it("syncing: behind the headers or in the first download", () => {
    expect(isSyncing({ blocks: 10, headers: 10, initialblockdownload: false })).toBe(false);
    expect(isSyncing({ blocks: 9, headers: 10, initialblockdownload: false })).toBe(true);
    expect(isSyncing({ blocks: 10, headers: 10, initialblockdownload: true })).toBe(true);
  });

  it("the sync percentage, never 100 while syncing", () => {
    expect(syncPercent({ blocks: 1, headers: 2, progress: 0.4718, syncing: true })).toBe("47.18");
    expect(syncPercent({ blocks: 1, headers: 2, progress: 0, syncing: true })).toBe("50.00");
    expect(syncPercent({ blocks: 99, headers: 100, progress: 1, syncing: true })).toBe("99.99");
  });

  it("the wallet summary: all balances, the password state", () => {
    expect(walletSummary({ mine: { trusted: 1, untrusted_pending: 0.5, immature: 0.25, stake: 0.4 } }, { walletname: "" })).toEqual({
      available: 1,
      pending: 0.5,
      inStake: 0.4,
      immature: 0.25,
      total: 2.15,
      encrypted: false,
      unlocked: false,
    });
    expect(walletSummary({ mine: { trusted: 0, untrusted_pending: 0, immature: 0 } }, { walletname: "", unlocked_until: 0 })).toMatchObject({ encrypted: true, unlocked: false });
    expect(walletSummary({ mine: { trusted: 0, untrusted_pending: 0, immature: 0 } }, { walletname: "", unlocked_until: 1_900_000_000 })).toMatchObject({
      encrypted: true,
      unlocked: true,
    });
  });

  it("addresses by label; one is made only when there is none", async () => {
    const api = createMockQtumApi();
    expect((await listAddresses(api)).map((a) => a.label)).toEqual(["", "savings"]);
    expect(api.calls.filter((c) => c.path === "getnewaddress")).toEqual([]);
    const empty = createMockQtumApi({ scenario: "backup-required" });
    expect(await addressesMakingOne(empty)).toHaveLength(1);
    expect(await addressesMakingOne(empty)).toHaveLength(1);
    expect(empty.calls.filter((c) => c.path === "getnewaddress")).toHaveLength(1);
  });
});
