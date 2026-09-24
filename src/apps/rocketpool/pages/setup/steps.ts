/**
 * The setup wizard's steps and how far a node is, from what the node reads
 * say. Pure, so every state is tested without rendering.
 */
import type { NodeStatus } from "../../api/models";
import { isZeroAddress, sameAddress, toBigInt } from "../../lib/units";

export type SetupStepId = "wallet" | "fund" | "register" | "withdrawal" | "smoothing" | "validators";

export interface SetupStep {
  id: SetupStepId;
  title: string;
  /** Shown under the title in the step list. */
  hint: string;
}

export const SETUP_STEPS: readonly SetupStep[] = [
  { id: "wallet", title: "Node wallet", hint: "Create or restore it" },
  { id: "fund", title: "Add ETH", hint: "For the bond and network fees" },
  { id: "register", title: "Register", hint: "Join Rocket Pool" },
  { id: "withdrawal", title: "Withdrawal address", hint: "Where your ETH goes" },
  { id: "smoothing", title: "Smoothing pool", hint: "Optional" },
  { id: "validators", title: "Validators", hint: "Start staking" },
];

export const isSetupStepId = (v: unknown): v is SetupStepId => SETUP_STEPS.some((s) => s.id === v);

/**
 * - done: nothing left to do
 * - pending: waiting for something outside this page (a withdrawal address to be confirmed)
 * - open: to do
 * - optional: a choice the owner may skip
 * - locked: an earlier step comes first
 * - unknown: the node could not be read yet
 */
export type StepStatus = "done" | "pending" | "open" | "optional" | "locked" | "unknown";

export interface SetupFacts {
  /** The wallet (and its password) exist on the box. */
  walletReady: boolean;
  /** `node/status`; undefined while not read (or not readable). */
  node?: NodeStatus;
}

/** Enough ETH to pay the fees of the setup transactions. */
export const FUNDED_WEI = 10n ** 16n; // 0.01 ETH

export function stepStatuses({ walletReady, node }: SetupFacts): Record<SetupStepId, StepStatus> {
  if (!walletReady) {
    return { wallet: "open", fund: "locked", register: "locked", withdrawal: "locked", smoothing: "locked", validators: "locked" };
  }
  if (!node) {
    return { wallet: "done", fund: "unknown", register: "unknown", withdrawal: "unknown", smoothing: "unknown", validators: "unknown" };
  }
  const balance = toBigInt(node.accountBalances?.eth) ?? 0n;
  const registered = node.registered;
  const hot = sameAddress(node.primaryWithdrawalAddress, node.accountAddress) || isZeroAddress(node.primaryWithdrawalAddress);
  const pending = !isZeroAddress(node.pendingPrimaryWithdrawalAddress);
  const hasValidators = (node.minipoolCounts?.total ?? 0) > 0 || node.megapoolDeployed;
  const afterRegister = (s: StepStatus): StepStatus => (registered ? s : "locked");
  return {
    wallet: "done",
    fund: registered || balance >= FUNDED_WEI ? "done" : "open",
    register: registered ? "done" : "open",
    withdrawal: afterRegister(!hot ? "done" : pending ? "pending" : "open"),
    smoothing: afterRegister(node.feeRecipientInfo?.isInSmoothingPool ? "done" : "optional"),
    validators: afterRegister(hasValidators ? "done" : "open"),
  };
}

/** Where `/setup` starts: the first step still to do (the optional smoothing pool only when nothing else is left). */
export function firstOpenStep(statuses: Record<SetupStepId, StepStatus>): SetupStepId {
  const todo = SETUP_STEPS.find((s) => s.id !== "smoothing" && (statuses[s.id] === "open" || statuses[s.id] === "unknown"));
  if (todo) return todo.id;
  if (statuses.smoothing === "optional") return "smoothing";
  return statuses.validators === "done" ? "validators" : "wallet";
}

/** The step after `id` (null after the last). */
export function nextStepId(id: SetupStepId): SetupStepId | null {
  const i = SETUP_STEPS.findIndex((s) => s.id === id);
  return SETUP_STEPS[i + 1]?.id ?? null;
}

/** The step a locked step waits for. */
export function blockingStep(id: SetupStepId, statuses: Record<SetupStepId, StepStatus>): SetupStepId | null {
  if (statuses[id] !== "locked") return null;
  if (statuses.wallet !== "done") return "wallet";
  return "register";
}
