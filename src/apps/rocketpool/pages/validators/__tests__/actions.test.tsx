import type { CanResponse, MinipoolCloseDetails } from "../../../api/models";
import { closeMinipoolFlow, minipoolPayout, updateMegapoolFlow } from "../actions";
import { megapoolDelegate } from "../model";

const ETH = 10n ** 18n;
const detail = (o: Partial<MinipoolCloseDetails>): MinipoolCloseDetails => ({
  address: "0x00000000000000000000000000000000000000aa",
  isFinalized: false,
  minipoolStatus: "Staking",
  minipoolVersion: 3,
  distributed: false,
  canClose: false,
  balance: String(32n * ETH),
  refund: 0,
  userDepositBalance: String(24n * ETH),
  beaconState: "withdrawal_done",
  nodeShare: String(8n * ETH),
  gasLimits: { estimated: 1, safe: 1 },
  ...o,
});
const reason = (d: MinipoolCloseDetails) =>
  closeMinipoolFlow(d.address).tx.blockedReason!({ status: "success", error: "", isFeeDistributorInitialized: true, details: [d] } as unknown as CanResponse);

describe("validator actions", () => {
  it("M7: a minipool that is back from the beacon chain but can't be closed gets a neutral reason", () => {
    expect(reason(detail({ canClose: false, beaconState: "withdrawal_done" }))).toBe("Rocket Pool says it can't be closed right now. Try again later.");
    expect(reason(detail({ canClose: false, beaconState: "active_exiting" }))).toMatch(/isn't back yet\. Exit it first/);
    expect(reason(detail({ canClose: false, minipoolVersion: 2 }))).toMatch(/old contract version/);
    expect(reason(detail({ canClose: true }))).toBeNull();
  });

  it("I2: without a fee distributor, closing is blocked and the owner is sent to support (nothing sets it up by itself)", () => {
    const r = closeMinipoolFlow("0xaa").tx.blockedReason!({ status: "success", error: "", isFeeDistributorInitialized: false, details: [] } as unknown as CanResponse);
    expect(r).toMatch(/isn't set up yet/);
    expect(r).toMatch(/contact AVADO support\.$/);
    expect(r).not.toMatch(/by itself|try again later/i);
  });

  it("I1: the megapool contract update: offered only when a newer version exists; one route-only lock; the megapool address", () => {
    const latest = "0x00000000000000000000000000000000000000Bb";
    const base = { useLatestDelegate: false, effectiveDelegateAddress: "0x00000000000000000000000000000000000000aa", delegateExpired: false };
    expect(megapoolDelegate(base, latest)).toEqual({ canUpdate: true, expired: false });
    expect(megapoolDelegate({ ...base, effectiveDelegateAddress: latest.toLowerCase() }, latest).canUpdate).toBe(false);
    expect(megapoolDelegate({ ...base, useLatestDelegate: true }, latest).canUpdate).toBe(false);
    expect(megapoolDelegate(base, undefined).canUpdate).toBe(false);
    expect(megapoolDelegate(base, "0x0000000000000000000000000000000000000000").canUpdate).toBe(false);
    const f = updateMegapoolFlow("0xABCdef0000000000000000000000000000000001", false);
    expect(f.tx).toMatchObject({
      canRoute: "megapool/can-delegate-upgrade",
      route: "megapool/delegate-upgrade",
      params: { address: "0xabcdef0000000000000000000000000000000001" },
      lockKey: "megapool/delegate-upgrade",
    });
    // Smartnode's check answers only a gas estimate: no flag to block on.
    expect(f.tx.blockedReason!({ status: "success", error: "" } as CanResponse)).toBeNull();
  });

  it("M2: a dissolved minipool pays out its balance, without adding the refund again", () => {
    expect(minipoolPayout({ status: "Dissolved", balance: String(5n * ETH), nodeShareOfBalance: String(5n * ETH), refund: String(ETH) })).toBe(5n * ETH);
    expect(minipoolPayout({ status: "Staking", balance: String(5n * ETH), nodeShareOfBalance: String(2n * ETH), refund: String(ETH) })).toBe(3n * ETH);
  });

  it("I1: the plain close never asks for a bundle; the bundle is explicit", () => {
    expect(closeMinipoolFlow("0xAA").tx.params).toEqual({ address: "0xaa", bundle: "false" });
    expect(closeMinipoolFlow("0xAA").tx.extraGas).toBeUndefined();
    expect(closeMinipoolFlow("0xAA", { bundle: true }).tx.params).toEqual({ address: "0xaa", bundle: "true" });
  });
});
