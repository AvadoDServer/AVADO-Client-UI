/**
 * "Claim everything" as Smartnode's own `rocketpool claims claim-all` composes
 * it (rocketpool-cli/claims/claim-all.go, v1.24.2): each source of rewards is
 * a separate transaction with its own check and fee.
 *
 *   1. megapool rewards        megapool/can-distribute → megapool/distribute
 *   2. fee distributor         node/can-distribute → node/distribute
 *   3. minipool balances       minipool/distribute-balance, one per minipool
 *   4. periodic rewards        node/claim-rewards (or claim-and-stake-rewards)
 *   5. unclaimed rewards       node/claim-unclaimed-rewards
 *   6. credit                  node/withdraw-credit (paid as rETH)
 *   7. ETH staked on behalf    node/withdraw-eth
 *
 * pDAO proposal bonds are left out (governance is not in scope).
 * Pure: amounts are exact bigints, except the fee distributor's share, which
 * Smartnode itself reports as a float (marked `approx`).
 */
import type {
  CanDistributeFeeDistributor,
  CanDistributeMegapool,
  MegapoolPendingRewards,
  MinipoolDistributeDetails,
  NodeStatus,
  RewardsInfo,
  RewardsInterval,
} from "../../api/models";
import { isZeroAddress, toBigInt, WEI_PER_ETH } from "../../lib/units";

export type ClaimKind = "megapool" | "fee-distributor" | "minipool" | "periodic" | "unclaimed" | "credit" | "eth-on-behalf";

export interface ClaimItem {
  /** Unique: "periodic", "minipool:0x…". */
  id: string;
  kind: ClaimKind;
  title: string;
  /** Where it goes and what it is, in plain words. */
  text: string;
  eth: bigint;
  rpl: bigint;
  /** The amount is Smartnode's rounded figure, not exact. */
  approx?: boolean;
  /** Minipool items: the minipool. */
  address?: string;
  /** Periodic rewards: the interval indices to claim. */
  indices?: number[];
}

export interface ClaimInputs {
  node: NodeStatus;
  rewards?: RewardsInfo;
  megapoolCan?: CanDistributeMegapool;
  megapoolPending?: MegapoolPendingRewards;
  feeDistributor?: CanDistributeFeeDistributor;
  minipoolBalances?: MinipoolDistributeDetails[] | null;
}

const big = (v: unknown): bigint => toBigInt(v as string | number | null | undefined) ?? 0n;

/** ETH as a float (Smartnode's fee-distributor share) → wei, rounded down to 6 decimals. */
export function floatEthToWei(eth: number): bigint {
  if (!Number.isFinite(eth) || eth <= 0) return 0n;
  return BigInt(Math.floor(eth * 1e6)) * (WEI_PER_ETH / 1_000_000n);
}

export const intervalRpl = (i: RewardsInterval): bigint => big(i.collateralRplAmount) + big(i.oDaoRplAmount);
export const intervalEth = (i: RewardsInterval): bigint => big(i.smoothingPoolEthAmount) + big(i.voterShareEth);

/** Everything that can be claimed now, in claim-all's order. Items with nothing in them are left out. */
export function claimItems({ node, rewards, megapoolCan, megapoolPending, feeDistributor, minipoolBalances }: ClaimInputs): ClaimItem[] {
  const items: ClaimItem[] = [];

  if (megapoolCan?.canDistribute && megapoolPending) {
    const eth = big(megapoolPending.rewardSplit?.NodeRewards) + big(megapoolPending.refundValue);
    if (eth > 0n) {
      items.push({
        id: "megapool",
        kind: "megapool",
        title: "Megapool rewards",
        text: "Execution-layer rewards (tips and MEV) collected by your megapool validators, plus any refund. Paid to your withdrawal address.",
        eth,
        rpl: 0n,
      });
    }
  }

  if (node.isFeeDistributorInitialized && feeDistributor && big(feeDistributor.balance) > 0n) {
    items.push({
      id: "fee-distributor",
      kind: "fee-distributor",
      title: "Fee distributor",
      text: "Tips and MEV your minipools earned outside the smoothing pool. Your share goes to your withdrawal address.",
      eth: floatEthToWei(feeDistributor.nodeShare),
      rpl: 0n,
      approx: true,
    });
  }

  for (const d of minipoolBalances ?? []) {
    if (!d.canDistribute) continue;
    const eth = d.status === "Dissolved" ? big(d.balance) : big(d.nodeShareOfBalance) + big(d.refund);
    if (eth <= 0n) continue;
    items.push({
      id: `minipool:${d.address.toLowerCase()}`,
      kind: "minipool",
      title: "Minipool rewards",
      text: "Beacon-chain rewards paid into this minipool. Your share goes to your withdrawal address.",
      eth,
      rpl: 0n,
      address: d.address,
    });
  }

  const intervals = rewards?.registered ? rewards.unclaimedIntervals : [];
  if (intervals.length > 0) {
    items.push({
      id: "periodic",
      kind: "periodic",
      title: "Periodic rewards",
      text: `RPL rewards and smoothing pool ETH from ${intervals.length} reward period${intervals.length === 1 ? "" : "s"}. Paid to your withdrawal address, or the RPL can be staked again.`,
      eth: intervals.reduce((a, i) => a + intervalEth(i), 0n),
      rpl: intervals.reduce((a, i) => a + intervalRpl(i), 0n),
      indices: intervals.map((i) => i.index),
    });
  }

  const unclaimed = big(node.unclaimedRewards);
  if (unclaimed > 0n) {
    items.push({
      id: "unclaimed",
      kind: "unclaimed",
      title: "Rewards that couldn't be delivered",
      text: "Rewards that were distributed earlier but couldn't be sent to your withdrawal address. Claiming sends them again.",
      eth: unclaimed,
      rpl: 0n,
    });
  }

  const credit = big(node.creditBalance);
  if (credit > 0n) {
    items.push({
      id: "credit",
      kind: "credit",
      title: "Credit",
      text: "ETH credited to your node (for example a bond back from a validator that left the queue). Withdrawn as the same value in rETH to your withdrawal address.",
      eth: credit,
      rpl: 0n,
    });
  }

  const onBehalf = big(node.ethOnBehalfBalance);
  if (onBehalf > 0n) {
    items.push({
      id: "eth-on-behalf",
      kind: "eth-on-behalf",
      title: "ETH staked on your behalf",
      text: "ETH someone staked for your node. Withdrawn to your withdrawal address.",
      eth: onBehalf,
      rpl: 0n,
    });
  }

  return items;
}

export function claimTotals(items: ClaimItem[]) {
  return {
    eth: items.reduce((a, i) => a + i.eth, 0n),
    rpl: items.reduce((a, i) => a + i.rpl, 0n),
    approx: items.some((i) => i.approx),
  };
}

/** Periods that can't be claimed yet: their rewards file is missing or doesn't match. */
export const blockedIntervals = (rewards?: RewardsInfo): number[] =>
  (rewards?.invalidIntervals ?? []).filter((i) => !i.treeFileExists || !i.merkleRootValid).map((i) => i.index);

/** Where rewards go: the withdrawal address, or the node wallet when none is set. */
export function payoutAddress(node: NodeStatus): { address: string; isNodeWallet: boolean } {
  const w = node.primaryWithdrawalAddress;
  const isNode = isZeroAddress(w) || w.toLowerCase() === node.accountAddress.toLowerCase();
  return { address: isNode ? node.accountAddress : w, isNodeWallet: isNode };
}
