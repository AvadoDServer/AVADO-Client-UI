import type { StatusTone } from "../../../components/ui";
import { isNodeStarting, isUnreachable } from "../api/errors";
import { BUSY_STATES, type WalletStatus } from "../api/models";
import { syncPercent, type NodeInfo } from "../api/node";

export interface NodeView {
  tone: StatusTone;
  label: string;
  /** Why it isn't running, and what to do (when it isn't). */
  hint?: string;
}

/**
 * The node's state in one word for the status strip (Running, Syncing n %,
 * Starting, Stopped, Can't connect), from the last RPC read and the monitor's
 * wallet status.
 */
export function describeNode({
  node,
  nodeError,
  walletStatus,
  packageDown,
}: {
  node: NodeInfo | undefined;
  nodeError: unknown;
  walletStatus: WalletStatus | undefined;
  packageDown: boolean;
}): NodeView {
  if (packageDown) {
    return {
      tone: "danger",
      label: "Can't connect",
      hint: "Can't reach the Qtum package on your AVADO. Check that the box is on and connected to your network, and that the Qtum package is running.",
    };
  }
  if (nodeError === undefined && node) {
    return node.syncing ? { tone: "warning", label: `Syncing ${syncPercent(node)}%` } : { tone: "success", label: "Running" };
  }
  if (nodeError === undefined) return { tone: "neutral", label: "Checking" };
  if (walletStatus?.state === "stopped") {
    return { tone: "danger", label: "Stopped", hint: "The Qtum node is stopped. Restart it in Settings; if it stays stopped, restart the package in the AVADO Admin." };
  }
  if (isNodeStarting(nodeError) || (walletStatus && BUSY_STATES.includes(walletStatus.state)) || isUnreachable(nodeError)) {
    return { tone: "warning", label: "Starting", hint: "The Qtum node is starting. This can take a few minutes." };
  }
  return { tone: "danger", label: "Not answering", hint: "The Qtum node is not answering. Restart it in Settings; if this stays, contact AVADO support." };
}
