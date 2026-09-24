/**
 * The transactions the Rocket Pool daemon sends by itself, and the gas
 * limits it obeys (spec §2.4). The values are the package's settings as
 * rendered into user-settings.yml on every start (build/user-settings.template).
 * A backend that reports them in `/api/avado/status` (`settings`) wins; until
 * then the template's values are shown and marked as such.
 */
import type { AvadoStatus, DaemonSettings } from "../../api/models";
import { toBigInt, WEI_PER_GWEI, type BigNumberish } from "../../lib/units";

/** The package template's values (build/user-settings.template). */
export const TEMPLATE_SETTINGS: Required<DaemonSettings> = {
  autoTxGasThreshold: "20",
  distributeThreshold: "1",
  manualMaxFee: "0",
  priorityFee: "0.01",
};

export function daemonSettings(avado: AvadoStatus | undefined): { values: Required<DaemonSettings>; reported: boolean } {
  const s = avado?.settings;
  return { values: { ...TEMPLATE_SETTINGS, ...(s ?? {}) }, reported: !!s };
}

export interface AutomaticAction {
  title: string;
  text: string;
}

/**
 * What the daemon does on its own (Smartnode v1.24.2 `rocketpool/node/*`
 * tasks), in plain words. `exits` marks the one an owner must know about:
 * the node can exit a validator without being asked here.
 */
export const AUTOMATIC_ACTIONS: AutomaticAction[] = [
  {
    title: "Exit a validator when Rocket Pool requires it",
    text: "If Rocket Pool asks one of your validators to leave (a protocol exit request), your node signs its exit by itself, as the rules require. An exit can't be undone. If a validator doesn't leave in time, Rocket Pool can force it out and penalise it.",
  },
  {
    title: "Start megapool validators",
    text: "Your node prepares new megapool validators (prestake) and, once Rocket Pool assigns them ETH, stakes them on the beacon chain.",
  },
  {
    title: "Report exits and final balances",
    text: "When a megapool validator has left the beacon chain, your node reports it so its ETH can be settled.",
  },
  {
    title: "Answer challenges",
    text: "If someone challenges one of your megapool validators (a disputed exit or performance), your node sends the proof that answers it.",
  },
  {
    title: "Keep minipool contracts up to date",
    text: "Once per minipool, your node switches it to follow the newest contract version (a one-time transaction each).",
  },
  {
    title: "Set up express tickets",
    text: "Once, your node sets up the express tickets your minipools earned.",
  },
  {
    title: "Distribute minipool balances",
    text: "When a minipool's balance grows above the limit below, your node pays out the rewards in it.",
  },
  {
    title: "Download reward files",
    text: "After each reward period your node downloads the file that lists everyone's rewards, so you can claim. No transaction.",
  },
];

/** "20" (gwei) → wei; null for anything that isn't a plain decimal. */
export function gweiToWei(gwei: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,9}))?$/.exec(gwei.trim());
  if (!m) return null;
  return BigInt(m[1]) * WEI_PER_GWEI + BigInt((m[2] ?? "").padEnd(9, "0") || "0");
}

/** Whether the current base fee is under the daemon's limit (so automatic actions go ahead now). */
export function underThreshold(baseFeeWei: BigNumberish | undefined, thresholdGwei: string): boolean | null {
  const base = toBigInt(baseFeeWei);
  const limit = gweiToWei(thresholdGwei);
  if (base === null || limit === null) return null;
  return base < limit;
}
