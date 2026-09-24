/**
 * RPL after Saturn (research §1.3):
 *  - Legacy RPL: staked for minipools. Unstaking it must leave at least the
 *    minimum (15% of the ETH the minipools borrowed, `rplStakeThreshold`)
 *    while minipools exist; RPL locked on the node can't be unstaked either.
 *  - Megapool RPL: optional, staked with `stake-rpl` (approve first).
 *  - Unstaking starts a waiting period (28 days today); then `withdraw-rpl`
 *    sends it to the RPL withdrawal address (or the node wallet).
 * Pure: exact bigints; time is passed in.
 */
import type { NodeStatus } from "../../api/models";
import { nsToMs, parseTime } from "../../lib/time";
import { isZeroAddress, sameAddress, toBigInt } from "../../lib/units";

const big = (v: unknown): bigint => toBigInt(v as string | number | null | undefined) ?? 0n;

export interface RplView {
  wallet: bigint;
  legacy: bigint;
  megapool: bigint;
  locked: bigint;
  /** The least legacy RPL that must stay staked while minipools exist. */
  legacyMinimum: bigint;
  /** The most legacy RPL that can be unstaked now. */
  legacyUnstakable: bigint;
  /** The most megapool RPL that can be unstaked now (CLI rule: megapool stake, and never locked RPL). */
  megapoolUnstakable: bigint;
  unstaking: bigint;
  /** When the unstaking RPL can be withdrawn (ms), if anything is unstaking. */
  withdrawableAt: number | null;
  unstakingState: "none" | "waiting" | "ready";
  /** The unstaking period, in ms (28 days today). */
  periodMs: number | null;
  /** RPL can only be unstaked and withdrawn by this separate address, not by the node. */
  otherRplAddress: string | null;
  /** 15 for 15%. */
  minimumPercent: number;
}

export function rplView(node: NodeStatus, nowMs: number): RplView {
  const legacy = big(node.rplStakeLegacy);
  const locked = big(node.nodeRPLLocked);
  // Rocket Pool's own figure (it is 0 once no minipools need it).
  const legacyMinimum = big(node.rplStakeThreshold);
  const free = legacy - locked - legacyMinimum;
  const unstaking = big(node.unstakingRPL);
  const periodMs = nsToMs(node.unstakingPeriodDuration);
  const last = parseTime(node.lastRPLUnstakeTime);
  const withdrawableAt = unstaking > 0n && last !== null && periodMs !== null ? last + periodMs : null;
  const chainNow = parseTime(node.latestBlockTime) ?? nowMs;
  const unstakingState = unstaking === 0n ? "none" : withdrawableAt !== null && chainNow < withdrawableAt ? "waiting" : "ready";
  const other =
    node.isRPLWithdrawalAddressSet && !isZeroAddress(node.rplWithdrawalAddress) && !sameAddress(node.rplWithdrawalAddress, node.accountAddress)
      ? node.rplWithdrawalAddress
      : null;
  return {
    wallet: big(node.accountBalances.rpl),
    legacy,
    megapool: big(node.rplStakeMegapool),
    locked,
    legacyMinimum,
    legacyUnstakable: free > 0n ? free : 0n,
    megapoolUnstakable: minBig(big(node.rplStakeMegapool), big(node.totalRplStake) - locked),
    unstaking,
    withdrawableAt,
    unstakingState,
    periodMs,
    otherRplAddress: other,
    minimumPercent: Math.round((node.rplStakeThresholdFraction ?? 0.15) * 100),
  };
}

function minBig(a: bigint, b: bigint): bigint {
  const m = a < b ? a : b;
  return m > 0n ? m : 0n;
}

/**
 * What a new unstake does to RPL that is already unstaking. RocketNodeStaking
 * (`_unstakeRPLFor` / `_unstakeLegacyRPL`, Saturn) first withdraws unstaking
 * RPL whose period has passed (only if its withdrawal cooldown has passed
 * too), then adds the new amount and restarts the timer for everything that
 * is unstaking. Smartnode's CLI (withdraw-rpl.go) warns the same way.
 */
export type UnstakeEffect =
  | { kind: "none" }
  /** Still waiting: the wait restarts for all of it, ending around `newEnd`. */
  | { kind: "restart"; amount: bigint; currentEnd: number | null; newEnd: number | null }
  /** Ready: normally paid out first by the unstake itself; withdrawing it first is the sure way. */
  | { kind: "ready"; amount: bigint };

export function unstakeEffect(v: RplView, nowMs: number): UnstakeEffect {
  if (v.unstaking === 0n || v.unstakingState === "none") return { kind: "none" };
  if (v.unstakingState === "ready") return { kind: "ready", amount: v.unstaking };
  return { kind: "restart", amount: v.unstaking, currentEnd: v.withdrawableAt, newEnd: v.periodMs !== null ? nowMs + v.periodMs : null };
}

/** A typed amount checked against a maximum: the wei, or why not. */
export function checkAmount(parsed: bigint | null, text: string, max: bigint): { wei: bigint | null; error?: string } {
  if (text.trim() === "") return { wei: null };
  if (parsed === null) return { wei: null, error: "Enter an amount like 100 or 12.5 (a dot for decimals)." };
  if (parsed === 0n) return { wei: null, error: "Enter more than 0." };
  if (parsed > max) return { wei: null, error: "That is more than is available." };
  return { wei: parsed };
}
