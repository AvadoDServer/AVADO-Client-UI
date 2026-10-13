import type { StatusTone } from "../../../components/ui";
import type { NodeInfo, WalletSummary } from "../api/node";
import type { StakingInfo, WalletStatus } from "../api/models";
import { formatDuration } from "../lib/format";

export type StakingReason =
  | "staking"
  | "wallet-not-ready"
  | "syncing"
  | "disabled"
  | "locked"
  | "no-coins"
  | "no-mature-coins"
  | "waiting"
  | "checking";

export interface StakingView {
  reason: StakingReason;
  tone: StatusTone;
  label: string;
  /** One or two sentences: why, and what to do. */
  text: string;
  /** Expected time to the next reward, in words, when staking. */
  expected?: string;
}

/** Coins can stake once they are this many blocks old (Qtum mainnet), about 4.5 hours at 32 s a block. */
export const STAKE_MIN_CONFIRMATIONS = 500;

/**
 * Is the wallet staking, and if not, why not (in plain words)? Anything not
 * loaded yet (undefined) gives "Checking" rather than a wrong reason.
 */
export function stakingView({
  walletStatus,
  node,
  wallet,
  staking,
}: {
  walletStatus: WalletStatus | undefined;
  node: NodeInfo | undefined;
  wallet: WalletSummary | undefined;
  staking: StakingInfo | undefined;
}): StakingView {
  if (staking?.staking) {
    const expected = staking.expectedtime > 0 ? formatDuration(staking.expectedtime) : undefined;
    return {
      reason: "staking",
      tone: "success",
      label: "Staking",
      text: expected
        ? "Your wallet is staking. Rewards come at random: the expected time is an average, so the next one can come sooner or later."
        : "Your wallet is staking. There is no estimate yet of when your next reward comes.",
      expected,
    };
  }
  if (walletStatus && walletStatus.state !== "ready") {
    return {
      reason: "wallet-not-ready",
      tone: "warning",
      label: "Not staking",
      text: "Your wallet is not ready, so it does not stake. The message at the top of the page says what is happening.",
    };
  }
  if (node?.syncing) {
    return {
      reason: "syncing",
      tone: "warning",
      label: "Not staking yet",
      text: "The Qtum node is still catching up with the network. Staking starts by itself once it has caught up.",
    };
  }
  if (!staking || !wallet || !node) return { reason: "checking", tone: "neutral", label: "Checking", text: "Checking whether your wallet is staking." };
  if (!staking.enabled) {
    return {
      reason: "disabled",
      tone: "danger",
      label: "Staking is off",
      text: "Staking is turned off in the Qtum node. Restart the node in Settings; if this stays, contact AVADO support.",
    };
  }
  if (wallet.encrypted && !wallet.unlocked) {
    return {
      reason: "locked",
      tone: "warning",
      label: "Not staking",
      text: "Your wallet is locked with a password, and a locked wallet does not stake. Unlock it for staking on the Wallet page.",
    };
  }
  if (wallet.total <= 0) {
    return {
      reason: "no-coins",
      tone: "accent",
      label: "Not staking",
      text: "Your wallet has no coins yet. Send QTUM to one of your addresses on the Wallet page to start staking.",
    };
  }
  if (!(staking.weight > 0)) {
    return {
      reason: "no-mature-coins",
      tone: "accent",
      label: "Not staking yet",
      text: `Your coins are not ready to stake yet. Coins can stake once they are ${STAKE_MIN_CONFIRMATIONS} blocks old: about four and a half hours after they arrive, and again after each reward.`,
    };
  }
  return {
    reason: "waiting",
    tone: "warning",
    label: "Not staking right now",
    text: "The node is not staking at this moment. This usually sorts itself out within a few minutes; if it stays, restart the node in Settings.",
  };
}
