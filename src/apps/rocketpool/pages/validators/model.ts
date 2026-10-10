/**
 * What the Validators page shows, from Smartnode's answers, in plain words.
 * Pure functions: no fetching, no React.
 */
import type {
  MegapoolDetails,
  MegapoolValidator,
  MinipoolCloseDetails,
  MinipoolDetails,
  MinipoolDistributeDetails,
} from "../../api/models";
import { sameAddress, toBigInt } from "../../lib/units";
import type { StatusTone } from "../../../../components/ui";

export interface Status {
  label: string;
  tone: StatusTone;
  /** One sentence on what it means and what happens next. */
  text: string;
}

/** Beacon states in which a validator has asked to leave, or has left. */
const LEAVING = new Set(["active_exiting", "active_slashed", "exited_unslashed", "exited_slashed", "withdrawal_possible", "withdrawal_done"]);

/** The last 6 characters of a minipool address, lower-case: what the owner types to confirm an exit. */
export const exitCodeForMinipool = (address: string): string => address.slice(-6).toLowerCase();

export interface MinipoolView {
  mp: MinipoolDetails;
  status: Status;
  close?: MinipoolCloseDetails;
  distribute?: MinipoolDistributeDetails;
  /** Can be exited now (voluntary exit). */
  canExit: boolean;
  /** Can be closed now: its ETH is back from the beacon chain. */
  canClose: boolean;
  /** Its balance can be distributed now (skimmed rewards). */
  canDistribute: boolean;
  /** Its delegate (contract code) is the newest, or follows the newest automatically. */
  delegate: { upToDate: boolean; followsLatest: boolean };
}

/** The minipool's state for the owner. `close` comes from the close-details read (it has the beacon state). */
export function minipoolStatus(mp: MinipoolDetails, close?: MinipoolCloseDetails): Status {
  if (mp.finalised || close?.isFinalized) {
    return { label: "Closed", tone: "neutral", text: "This minipool is finished: its ETH was paid out and it is closed." };
  }
  const s = mp.status.status;
  if (s === "Dissolved") {
    return { label: "Dissolved", tone: "warning", text: "It never started validating. Close it to get its ETH back." };
  }
  if (s === "Initialized" || s === "Prelaunch") {
    return { label: "Starting", tone: "accent", text: "Waiting for Rocket Pool to start it." };
  }
  if (close?.canClose) {
    return {
      label: "Exited, ready to close",
      tone: "warning",
      text: "It has stopped validating and its ETH is back. Close it to pay out your share.",
    };
  }
  const beacon = close?.beaconState ?? "";
  if (LEAVING.has(beacon)) {
    return {
      label: "Exiting",
      tone: "accent",
      text: "It has asked to stop validating. Its ETH comes back after the network's waiting lines, which can take days to weeks.",
    };
  }
  if (s === "Withdrawable") {
    return { label: "Exited", tone: "accent", text: "It has stopped validating. Close it once its ETH has arrived." };
  }
  if (!mp.validator.exists) {
    return { label: "Starting", tone: "accent", text: "The network hasn't picked up this validator yet. This happens by itself." };
  }
  if (!mp.validator.active) {
    return { label: "Activating", tone: "accent", text: "The network is starting this validator. This happens by itself." };
  }
  return { label: "Staking", tone: "success", text: "Validating and earning rewards." };
}

export function minipoolView(
  mp: MinipoolDetails,
  latestDelegate: string | undefined,
  closeDetails: MinipoolCloseDetails[] | null | undefined,
  distributeDetails: MinipoolDistributeDetails[] | null | undefined,
): MinipoolView {
  const close = closeDetails?.find((d) => sameAddress(d.address, mp.address));
  const distribute = distributeDetails?.find((d) => sameAddress(d.address, mp.address));
  const status = minipoolStatus(mp, close);
  const leaving = LEAVING.has(close?.beaconState ?? "");
  const finished = mp.finalised || !!close?.isFinalized;
  return {
    mp,
    status,
    close,
    distribute,
    canExit: !finished && mp.status.status === "Staking" && mp.validator.exists && mp.validator.active && !leaving && !close?.canClose,
    canClose: !finished && !!close?.canClose,
    canDistribute: !finished && !!distribute?.canDistribute && !close?.canClose,
    delegate: {
      upToDate: !!latestDelegate && sameAddress(mp.effectiveDelegate, latestDelegate),
      followsLatest: mp.useLatestDelegate,
    },
  };
}

/** Minipools still to show: closed ones go to the end. */
export function sortMinipools(views: MinipoolView[]): MinipoolView[] {
  const rank = (v: MinipoolView) => (v.canClose ? 0 : v.status.label === "Closed" ? 3 : v.status.tone === "success" ? 2 : 1);
  return [...views].sort((a, b) => rank(a) - rank(b));
}

/* ------------------------------------------------------------------ */
/* Megapool                                                            */
/* ------------------------------------------------------------------ */

export interface MegapoolValidatorView {
  v: MegapoolValidator;
  status: Status;
  /** Can be exited now (voluntary exit). */
  canExit: boolean;
  /** Waiting in the deposit queue: can leave it (bond back as credit). */
  canLeaveQueue: boolean;
  /** Its beacon-chain index as text, when it has one. */
  index: string | null;
}

export function megapoolValidatorStatus(v: MegapoolValidator): Status {
  const beacon = v.beaconStatus?.status ?? "";
  if (v.dissolved) return { label: "Dissolved", tone: "danger", text: "It was dissolved and will not validate." };
  if (beacon === "active_slashed" || beacon === "exited_slashed") {
    return { label: "Slashed", tone: "danger", text: "The network penalised this validator and is removing it. Contact AVADO support." };
  }
  if (v.exited) return { label: "Exited", tone: "neutral", text: "It has stopped validating and its ETH is settled." };
  if (v.locked) {
    return {
      label: "Finishing its exit",
      tone: "accent",
      text: "It has stopped validating. Rocket Pool is settling its final balance; your node does this by itself.",
    };
  }
  if (v.exiting || LEAVING.has(beacon)) {
    return {
      label: "Exiting",
      tone: "accent",
      text: "It has asked to stop validating. Its ETH comes back after the network's waiting lines, which can take days to weeks.",
    };
  }
  if (v.inQueue) {
    const pos = toBigInt(v.queuePosition);
    return {
      label: pos !== null && pos > 0n ? `In the queue (position ${pos.toLocaleString("en-US")})` : "In the queue",
      tone: "accent",
      text: "Waiting in line for ETH from Rocket Pool's stakers. It starts validating after that, by itself.",
    };
  }
  if (v.inPrestake) {
    return { label: "Waiting to stake", tone: "accent", text: "Its deposit was accepted. Your node starts it by itself once it has been checked." };
  }
  if (beacon === "pending_initialized" || beacon === "pending_queued") {
    return { label: "Activating", tone: "accent", text: "The network is starting this validator. This happens by itself." };
  }
  if (v.staked && beacon === "active_ongoing") return { label: "Active", tone: "success", text: "Validating and earning rewards." };
  if (v.staked) return { label: "Staked", tone: "accent", text: "Staked. Waiting for the network to show it." };
  return { label: "Unknown", tone: "neutral", text: "Rocket Pool reports a state this page doesn't know. If it stays like this, contact AVADO support." };
}

export function megapoolValidatorView(v: MegapoolValidator): MegapoolValidatorView {
  const status = megapoolValidatorStatus(v);
  const beacon = v.beaconStatus?.status ?? "";
  const index = v.validatorIndex > 0 ? String(v.validatorIndex) : v.beaconStatus?.index ? String(v.beaconStatus.index) : null;
  return {
    v,
    status,
    index,
    canExit: v.staked && !v.exiting && !v.exited && !v.locked && !v.dissolved && beacon === "active_ongoing" && index !== null,
    canLeaveQueue: v.inQueue && !v.dissolved,
  };
}

/**
 * The megapool's contract version (its delegate): up to date when it follows
 * the latest automatically or already is the latest. An update is offered
 * when a newer one exists (`megapool/delegate-upgrade`).
 */
export function megapoolDelegate(m: Pick<MegapoolDetails, "useLatestDelegate" | "effectiveDelegateAddress" | "delegateExpired">, latestDelegate: string | undefined) {
  const known = !!latestDelegate && !/^0x0{40}$/i.test(latestDelegate);
  const upToDate = m.useLatestDelegate || !known || sameAddress(m.effectiveDelegateAddress, latestDelegate!);
  return { canUpdate: !upToDate, expired: m.delegateExpired };
}

/** Totals for the megapool header. */
export function megapoolSummary(m: MegapoolDetails) {
  const debt = toBigInt(m.nodeDebt) ?? 0n;
  const refund = toBigInt(m.refundValue) ?? 0n;
  return {
    hasDebt: debt > 0n,
    debt,
    hasRefund: refund > 0n,
    refund,
    queued: m.validators.filter((v) => v.inQueue).length,
    exiting: m.exitingValidatorCount,
    locked: m.lockedValidatorCount,
  };
}
