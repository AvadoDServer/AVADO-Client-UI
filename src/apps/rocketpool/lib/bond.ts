/**
 * The ETH bond for new megapool validators, computed the way Smartnode's own
 * CLI does it (`rocketpool-cli/megapool/deposit.go` v1.24.2):
 *
 *   bonded₁  = nodeBond + nodeQueuedBond
 *   bondedᵢ  = requirement(active + i − 1)      for i ≥ 2
 *   bondᵢ    = clamp(requirement(active + i) − bondedᵢ, 1 ETH, 32 ETH)
 *
 * where `requirement(n)` is `node/get-bond-requirement?numValidators=n`, the
 * total bond Rocket Pool wants for n validators.
 */
const ETH = 10n ** 18n;
export const MIN_VALIDATOR_BOND_WEI = 1n * ETH;
export const MAX_VALIDATOR_BOND_WEI = 32n * ETH;

/** The most validators Smartnode's CLI creates in one deposit. */
export const MAX_DEPOSIT_COUNT = 35;

/**
 * Per-validator bonds for `requirements.length` new validators.
 * `requirements[k]` = requirement(active + k + 1); `bonded` = nodeBond + nodeQueuedBond.
 */
export function newValidatorBonds(requirements: readonly bigint[], bonded: bigint): bigint[] {
  return requirements.map((req, k) => {
    const already = k === 0 ? bonded : requirements[k - 1];
    const diff = req - already;
    return diff < MIN_VALIDATOR_BOND_WEI ? MIN_VALIDATOR_BOND_WEI : diff > MAX_VALIDATOR_BOND_WEI ? MAX_VALIDATOR_BOND_WEI : diff;
  });
}

export const sumWei = (values: readonly bigint[]): bigint => values.reduce((a, b) => a + b, 0n);
