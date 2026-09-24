import type { CanResponse, MinipoolCloseDetails } from "../../../api/models";
import { closeMinipoolFlow, minipoolPayout } from "../actions";

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
    expect(reason(detail({ canClose: false, beaconState: "withdrawal_done" }))).toBe("Rocket Pool says it can't be closed right now.");
    expect(reason(detail({ canClose: false, beaconState: "active_exiting" }))).toMatch(/isn't back from the beacon chain yet/);
    expect(reason(detail({ canClose: false, minipoolVersion: 2 }))).toMatch(/old contract version/);
    expect(reason(detail({ canClose: true }))).toBeNull();
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
