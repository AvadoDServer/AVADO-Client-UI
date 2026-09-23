/**
 * Plain-language words for what the beacon node says about a validator
 * (spec §4). Pure functions only, so the table, the phone cards and the
 * dialogs all say the same thing.
 */
import type { StatusTone } from "../../components/ui";
import type { ValidatorState, ValidatorStatus } from "../../api/types";
import type { Network } from "../../config/clientConfig";

export interface StatusText {
  label: string;
  tone: StatusTone;
  /** One sentence for a tooltip or the card: what it means for the owner. */
  detail: string;
}

const STATUS: Record<ValidatorStatus, StatusText> = {
  pending_initialized: {
    label: "Deposit received",
    tone: "accent",
    detail: "The beacon chain has seen the deposit. The validator joins the activation queue soon.",
  },
  pending_queued: {
    label: "Waiting to activate",
    tone: "accent",
    detail: "The validator is in the activation queue. It starts validating when its turn comes.",
  },
  active_ongoing: {
    label: "Active",
    tone: "success",
    detail: "The validator is validating and earning rewards.",
  },
  active_exiting: {
    label: "Exiting",
    tone: "warning",
    detail: "An exit was requested. Keep the node running until the status is Exited.",
  },
  active_slashed: {
    label: "Slashed",
    tone: "danger",
    detail: "The validator was slashed and is being removed from the beacon chain.",
  },
  exited_unslashed: {
    label: "Exited",
    tone: "neutral",
    detail: "The validator has stopped validating. Its balance becomes withdrawable later.",
  },
  exited_slashed: {
    label: "Exited after slashing",
    tone: "danger",
    detail: "The validator was slashed and has stopped validating. Its balance becomes withdrawable later.",
  },
  withdrawal_possible: {
    label: "Exited, withdrawal pending",
    tone: "neutral",
    detail: "The validator has exited. Its balance is paid to the withdrawal address automatically.",
  },
  withdrawal_done: {
    label: "Withdrawn",
    tone: "neutral",
    detail: "The validator has exited and its balance has been withdrawn.",
  },
};

/** The beacon node answered 404: it has no record of this key yet. */
export const WAITING_FOR_DEPOSIT: StatusText = {
  label: "Waiting for deposit",
  tone: "neutral",
  detail:
    "The beacon chain doesn't know this key yet. That's normal for a new key: it shows up some hours after the deposit is made.",
};

/** The beacon node could not be asked (starting, syncing or unreachable). */
export const STATUS_UNAVAILABLE: StatusText = {
  label: "Status not available",
  tone: "neutral",
  detail: "The beacon node didn't answer. This page tries again by itself.",
};

/**
 * `state` is what `beacon.validator()` returned: a record, `null` for a 404
 * (waiting for deposit) or `undefined` when the call failed.
 */
export function validatorStatusText(state: ValidatorState | null | undefined): StatusText {
  if (state === null) return WAITING_FOR_DEPOSIT;
  if (state === undefined) return STATUS_UNAVAILABLE;
  return (
    STATUS[state.status] ?? {
      label: String(state.status).replace(/_/g, " "),
      tone: "neutral",
      detail: "The beacon node reported a status this page doesn't know.",
    }
  );
}

// ---------------------------------------------------------------------------
// Withdrawal credentials
// ---------------------------------------------------------------------------

export type WithdrawalKind = "bls" | "execution" | "compounding" | "unknown";

export interface WithdrawalText extends StatusText {
  kind: WithdrawalKind;
  /** The withdrawal address for 0x01/0x02 credentials. */
  address?: string;
}

/** Map 0x00/0x01/0x02 withdrawal credentials to plain words. */
export function withdrawalText(credentials: string | undefined | null): WithdrawalText {
  const c = (credentials ?? "").toLowerCase();
  if (c.startsWith("0x00")) {
    return {
      kind: "bls",
      label: "Needs a withdrawal address",
      tone: "warning",
      detail:
        "This validator has old (0x00) withdrawal credentials. Rewards and the balance can't be paid out until you set a withdrawal address.",
    };
  }
  const address = /^0x0[12][0-9a-f]{22}([0-9a-f]{40})$/.exec(c)?.[1];
  if (c.startsWith("0x01")) {
    return {
      kind: "execution",
      label: "Withdrawal address set",
      tone: "success",
      detail: "Rewards above 32 ETH are paid to the withdrawal address automatically (0x01).",
      address: address ? `0x${address}` : undefined,
    };
  }
  if (c.startsWith("0x02")) {
    return {
      kind: "compounding",
      label: "Withdrawal address set",
      tone: "success",
      detail: "Compounding validator (0x02): rewards stay staked up to 2048 ETH. The withdrawal address receives the rest.",
      address: address ? `0x${address}` : undefined,
    };
  }
  return {
    kind: "unknown",
    label: "Unknown",
    tone: "neutral",
    detail: "Known once the beacon chain has seen the deposit.",
  };
}

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------

/** A voluntary exit is only possible for a validator that is active and not exiting yet. */
export function canExit(state: ValidatorState | null | undefined): boolean {
  return !!state && state.status === "active_ongoing";
}

/**
 * Balance in the network's unit. Beacon balances are Gwei; on Gnosis they are
 * mGNO-Gwei, and 32 mGNO is 1 GNO.
 */
export function formatBalance(gwei: string | undefined, network: Network): string {
  if (gwei === undefined || gwei === "" || !/^\d+$/.test(gwei)) return "—";
  const value = Number(gwei) / 1e9;
  if (network === "gnosis") return `${(value / 32).toFixed(4)} GNO`;
  return `${value.toFixed(4)} ETH`;
}

/** `0x8f3a…c21d` for display. */
export function shortHex(hex: string, head = 6, tail = 4): string {
  if (!hex) return "";
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (body.length <= head + tail) return `0x${body}`;
  return `0x${body.slice(0, head)}…${body.slice(-tail)}`;
}

/** The first 8 hex characters of a pubkey, without 0x (used in file names). */
export function pk8(pubkey: string): string {
  return (pubkey.startsWith("0x") ? pubkey.slice(2) : pubkey).slice(0, 8).toLowerCase();
}

export function slashingProtectionFileName(pubkey: string): string {
  return `slashing-protection-${pk8(pubkey)}.json`;
}

const BEACONCHAIN: Record<Network, string> = {
  mainnet: "https://beaconcha.in",
  holesky: "https://holesky.beaconcha.in",
  hoodi: "https://hoodi.beaconcha.in",
  prater: "https://prater.beaconcha.in",
  gnosis: "https://gnosischa.in",
};

/** A link to a validator's page on the block explorer (a plain link, never an API call). */
export function beaconchainValidatorUrl(network: Network, pubkeyOrIndex: string): string {
  return `${BEACONCHAIN[network]}/validator/${pubkeyOrIndex}`;
}

/** A dashboard with several validators, by index. */
export function beaconchainDashboardUrl(network: Network, indices: string[]): string {
  return `${BEACONCHAIN[network]}/dashboard?validators=${indices.join(",")}`;
}

export const FEE_RECIPIENT_RE = /^0x[a-fA-F0-9]{40}$/;

export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

const ZERO_ADDRESS = /^0x0{40}$/;

export type FeeRecipientKind = "default" | "custom" | "none" | "unknown";

export interface FeeRecipientInfo {
  kind: FeeRecipientKind;
  address?: string;
  label: string;
}

/**
 * Tell a per-validator override from the default. The keymanager reports the
 * override or (Nimbus) the default when there is none; a zero address or no
 * answer means none.
 */
export function feeRecipientInfo(reported: string | null | undefined, defaultFeeRecipient: string): FeeRecipientInfo {
  if (reported === undefined) return { kind: "unknown", label: "Not available" };
  const r = reported && !ZERO_ADDRESS.test(reported) ? reported : "";
  if (!r || sameAddress(r, defaultFeeRecipient)) {
    return defaultFeeRecipient
      ? { kind: "default", address: defaultFeeRecipient, label: "Default" }
      : { kind: "none", label: "Not set" };
  }
  return { kind: "custom", address: r, label: "Custom" };
}
