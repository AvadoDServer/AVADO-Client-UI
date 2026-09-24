import { DEMO, SCENARIOS } from "../../../api/fixtures";
import type {
  CanDistributeFeeDistributor,
  CanDistributeMegapool,
  MegapoolPendingRewards,
  MinipoolDistributeDetailsResponse,
  NodeStatus,
  RewardsInfo,
} from "../../../api/models";
import { blockedIntervals, claimItems, claimTotals, ethOnBehalfElsewhere, floatEthToWei, payoutAddress } from "../model";

const ETH = 10n ** 18n;
const milli = (n: number) => (BigInt(n) * ETH) / 10_000n; // n / 10,000 ETH
const inputs = (name: keyof typeof SCENARIOS) => {
  const r = SCENARIOS[name].reads;
  const get = <T,>(k: string) => (k in r ? (r[k] as T) : undefined);
  return {
    node: get<NodeStatus>("node/status")!,
    rewards: get<RewardsInfo>("node/get-rewards-info"),
    megapoolCan: get<CanDistributeMegapool>("megapool/can-distribute"),
    megapoolPending: get<MegapoolPendingRewards>("megapool/pending-rewards"),
    feeDistributor: get<CanDistributeFeeDistributor>("node/can-distribute"),
    minipoolBalances: get<MinipoolDistributeDetailsResponse>("minipool/get-distribute-balance-details")?.details,
  };
};

describe("claim everything, as Smartnode's claim-all composes it", () => {
  it("a minipool node: each minipool's rewards, the periodic rewards and undelivered rewards, exact", () => {
    const items = claimItems(inputs("minipool"));
    expect(items.map((i) => i.id)).toEqual([`minipool:${DEMO.minipoolA.toLowerCase()}`, `minipool:${DEMO.minipoolB.toLowerCase()}`, "periodic", "unclaimed"]);
    const periodic = items.find((i) => i.kind === "periodic")!;
    expect(periodic.indices).toEqual([42, 43]);
    expect(periodic.rpl).toBe(184_412n * 10n ** 14n + 179_021n * 10n ** 14n);
    expect(periodic.eth).toBe(milli(412) + milli(388));
    expect(claimTotals(items)).toEqual({ eth: milli(187) + milli(214) + milli(800) + milli(931), rpl: periodic.rpl, approx: false });
  });

  it("a mixed node: megapool rewards first, then the fee distributor (Smartnode's rounded share), minipools, periodic", () => {
    const items = claimItems(inputs("mixed"));
    expect(items.map((i) => i.kind)).toEqual(["megapool", "fee-distributor", "minipool", "periodic", "unclaimed"]);
    expect(items[0].eth).toBe(milli(214));
    expect(items[1]).toMatchObject({ eth: milli(412), approx: true });
    expect(claimTotals(items).approx).toBe(true);
  });

  it("while a megapool validator exits there is nothing to distribute from it; credit can be withdrawn", () => {
    const items = claimItems(inputs("exits"));
    expect(items.map((i) => i.kind)).toEqual(["fee-distributor", "periodic", "credit"]);
    expect(items.find((i) => i.kind === "credit")!.eth).toBe(4n * ETH);
  });

  it("leaves out what is empty or not claimable", () => {
    const base = inputs("minipool");
    const items = claimItems({
      ...base,
      node: { ...base.node, unclaimedRewards: 0, isFeeDistributorInitialized: false },
      feeDistributor: { status: "success", error: "", balance: "5", nodeShare: 1 },
      rewards: { ...base.rewards!, registered: false },
      minipoolBalances: base.minipoolBalances!.map((d) => ({ ...d, canDistribute: false })),
    });
    expect(items).toEqual([]);
  });

  it("converts Smartnode's float share to wei, rounded down", () => {
    expect(floatEthToWei(0.0412)).toBe(41_200_000_000_000_000n);
    expect(floatEthToWei(1.23456789)).toBe(1_234_567_000_000_000_000n);
    expect(floatEthToWei(-1)).toBe(0n);
    expect(floatEthToWei(Number.NaN)).toBe(0n);
  });

  it("lists periods whose rewards file isn't there yet", () => {
    const rewards = inputs("minipool").rewards!;
    const bad = { ...rewards.unclaimedIntervals[0], index: 40, treeFileExists: false };
    expect(blockedIntervals({ ...rewards, invalidIntervals: [bad, { ...bad, index: 41, treeFileExists: true, merkleRootValid: true }] })).toEqual([40]);
    expect(blockedIntervals(undefined)).toEqual([]);
  });

  it("knows where rewards are paid", () => {
    expect(payoutAddress(inputs("minipool").node)).toEqual({ address: DEMO.coldWallet, isNodeWallet: false });
    expect(payoutAddress(inputs("mixed").node)).toEqual({ address: DEMO.nodeAddress, isNodeWallet: true });
  });

  it("M1: ETH staked on the node's behalf is claimable here only while the withdrawal address is the node", () => {
    const withAddress = { ...inputs("minipool").node, ethOnBehalfBalance: String(2n * ETH) }; // cold withdrawal address
    expect(claimItems({ ...inputs("minipool"), node: withAddress }).some((i) => i.kind === "eth-on-behalf")).toBe(false);
    expect(ethOnBehalfElsewhere(withAddress)).toBe(2n * ETH);
    const hot = { ...inputs("mixed").node, ethOnBehalfBalance: String(2n * ETH) }; // withdrawal address = node
    expect(claimItems({ ...inputs("mixed"), node: hot }).find((i) => i.kind === "eth-on-behalf")?.eth).toBe(2n * ETH);
    expect(ethOnBehalfElsewhere(hot)).toBe(0n);
  });
});
