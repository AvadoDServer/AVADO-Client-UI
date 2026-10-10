/**
 * The network fee of a transaction, from Smartnode's `can-X` gas limits and
 * the latest block's base fee (`service/get-gas-price-from-latest-block`).
 *
 * The same numbers go into the request, so the owner's "at most" is a hard
 * cap: `maxFee` = 2 × base fee + tip (EIP-1559 headroom for two full blocks),
 * `gasLimit` = Smartnode's safe limit. Unused gas is not charged, so the real
 * cost is usually close to "about".
 */
import type { GasLimits, GasParams } from "../api/models";
import { toBigInt, weiToGweiString, type BigNumberish } from "../lib/units";

/** Tip for the block builder. 1 gwei gets a transaction into the next blocks on mainnet today. */
export const DEFAULT_PRIORITY_FEE_WEI = 1_000_000_000n;

export interface GasQuote {
  /** estimated gas × (base fee + tip) */
  estimatedCostWei: bigint;
  /** safe gas limit × max fee: the most it can cost */
  maxCostWei: bigint;
  baseFeeWei: bigint;
  priorityFeeWei: bigint;
  maxFeeWei: bigint;
  gasLimit: number;
  estimatedGas: number;
  /**
   * Gas of a second transaction Smartnode sends with this one (a close
   * bundle's fixed-limit second step): counted in both costs, never in
   * `gasLimit` (the field sent for the first transaction).
   */
  extraGas: number;
}

/** Null when there is no usable estimate (no limits, zero limits, or no base fee). */
export function quoteGas(
  limits: GasLimits | null | undefined,
  baseFee: BigNumberish | null | undefined,
  priorityFeeWei: bigint = DEFAULT_PRIORITY_FEE_WEI,
  extraGas = 0,
): GasQuote | null {
  const base = toBigInt(baseFee);
  if (!limits || base === null || base < 0n) return null;
  const estimated = Number(limits.estimated);
  const safe = Math.max(Number(limits.safe), estimated);
  if (!Number.isSafeInteger(estimated) || estimated <= 0 || !Number.isSafeInteger(safe)) return null;
  if (!Number.isSafeInteger(extraGas) || extraGas < 0) return null;
  const maxFeeWei = 2n * base + priorityFeeWei;
  return {
    estimatedCostWei: BigInt(estimated + extraGas) * (base + priorityFeeWei),
    maxCostWei: BigInt(safe + extraGas) * maxFeeWei,
    baseFeeWei: base,
    priorityFeeWei,
    maxFeeWei,
    gasLimit: safe,
    estimatedGas: estimated,
    extraGas,
  };
}

/** The gas fields for the write request, matching the quote the owner confirmed. */
export function gasParams(q: GasQuote): GasParams {
  return {
    maxFee: weiToGweiString(q.maxFeeWei),
    maxPrioFee: weiToGweiString(q.priorityFeeWei),
    gasLimit: String(q.gasLimit),
  };
}
