/**
 * The Rocket Pool app's problem banners: pure rules over what the shell has
 * loaded from `/api/avado/status` and `/api/avado/reconcile`. Anything not
 * loaded yet never raises a problem. Most serious first.
 */
import { ADMIN_STORE_URL, adminPackageUrl } from "../../../components/shell/links";
import type { Problem, ProblemTone } from "../../../components/shell/problems";
import type { AvadoStatus, NodeStatus, ReconcileKeyState, ReconcileStatus, ReconcileView } from "../api/models";
import { reconcileStatusOf } from "../api/reconcile";
import { formatEth, isZeroAddress, sameAddress, toBigInt } from "../lib/units";

export const RP_PACKAGE = "rocketpool.avado.dnp.dappnode.eth";
export const SUPPORT_EMAIL = "support@ava.do";

export type RpProblemId =
  | "backend-unreachable"
  | "network-unsupported"
  | "startup-error"
  | "daemon-stopped"
  | "daemon-starting"
  | "no-wallet"
  | "password-missing"
  | "legacy-mnemonic"
  | "no-consensus-client"
  | "keys-awaiting-approval"
  | "keys-not-loaded"
  | "fee-recipient-failed"
  | "reconcile-failed"
  | "reconcile-errors"
  | "withdrawal-is-hot-wallet"
  | "low-gas-balance";

export type RpProblem = Problem<RpProblemId>;

/** Supervisord states in which the daemon is not running and won't be soon. */
const STOPPED_STATES = new Set(["FATAL", "BACKOFF", "EXITED", "STOPPED", "STOPPING"]);

const TONE_ORDER: Record<ProblemTone, number> = { danger: 0, warning: 1, accent: 2 };
const bySeverity = (a: RpProblem, b: RpProblem) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone];

const lastLines = (lines: string[] | undefined, n = 3) => (lines ?? []).filter((l) => l.trim()).slice(-n);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface StatusProblemInputs {
  /** The last `/api/avado/status` answer. */
  avado?: AvadoStatus | null;
  /** The last status poll failed: the package itself isn't answering. */
  avadoFailed?: boolean;
  /** The last `/api/avado/reconcile` answer. */
  reconcile?: ReconcileView | null;
}

/** The banners every page shows (the shell's): package, daemon, wallet files, validator keys. */
export function findStatusProblems({ avado, avadoFailed, reconcile }: StatusProblemInputs): RpProblem[] {
  const packagePage = adminPackageUrl(RP_PACKAGE);

  if (avadoFailed) {
    // Nothing else from the package can be trusted while it doesn't answer.
    return [
      {
        id: "backend-unreachable",
        tone: "danger",
        title: "The Rocket Pool package is not answering",
        body: "It may be restarting after an update. If this stays for more than a few minutes, restart the package from the AVADO Admin.",
        action: { label: "Open in the AVADO Admin", href: packagePage },
      },
    ];
  }
  if (!avado) return [];

  const out: RpProblem[] = [];
  const state = String(avado.daemon?.state ?? "UNKNOWN").toUpperCase();
  const stopped = STOPPED_STATES.has(state);

  if (!avado.networkSupported) {
    out.push({
      id: "network-unsupported",
      tone: "danger",
      title: "Unsupported network",
      body: `This package runs on Ethereum mainnet only, but it is set to "${avado.network}". Rocket Pool will not start on it.`,
      action: { label: "Open in the AVADO Admin", href: packagePage },
    });
  }

  if (avado.startupError) {
    out.push({
      id: "startup-error",
      tone: "danger",
      title: "Rocket Pool could not start",
      body: `${avado.startupError} Your wallet and validator keys are not affected.`,
      details: lastLines(avado.daemonErrors),
      action: { label: "See the logs", to: "/advanced" },
    });
  } else if (stopped) {
    out.push({
      id: "daemon-stopped",
      tone: "danger",
      title: "The Rocket Pool service has stopped",
      body: "Your node is not doing its Rocket Pool duties while it is stopped. Restarting the package usually helps; if it stays, contact AVADO support.",
      details: lastLines(avado.daemonErrors),
      action: { label: "Open in the AVADO Admin", href: packagePage },
    });
  }

  const running = state === "RUNNING";
  const ready = running && avado.apiReachable && avado.apiTokenPresent;
  if (!stopped && !avado.startupError && !ready && (state === "STARTING" || running)) {
    out.push({
      id: "daemon-starting",
      tone: "accent",
      title: "Rocket Pool is starting",
      body: "This can take a few minutes after a restart or an update. This page fills in once it's ready.",
      action: { label: "See the logs", to: "/advanced" },
    });
  }

  if (!avado.walletFilePresent) {
    if (ready) {
      out.push({
        id: "no-wallet",
        tone: "accent",
        title: "Set up your node",
        body: "This node has no Rocket Pool wallet yet. Create a new one or restore one you already have.",
        action: { label: "Start setup", to: "/setup" },
      });
    }
  } else if (!avado.passwordFilePresent) {
    out.push({
      id: "password-missing",
      tone: "danger",
      title: "The wallet password file is missing",
      body: "Rocket Pool can't unlock the node wallet without it, so it can't validate or send transactions. Contact AVADO support before changing anything.",
      action: { label: "Contact support", href: `mailto:${SUPPORT_EMAIL}` },
    });
  }

  if (avado.legacyMnemonicPresent) {
    out.push({
      id: "legacy-mnemonic",
      tone: "warning",
      title: "Your recovery phrase is stored in a plain file",
      body: "The previous version of this package kept your recovery phrase unprotected on the AVADO. Make sure you have your own safe copy, then remove the file from the Wallet page.",
      action: { label: "Open Wallet", to: "/wallet" },
    });
  }

  // Validator keys: only meaningful while the daemon runs and a wallet exists.
  const status = reconcileStatusOf(reconcile);
  if (status && ready && avado.walletFilePresent) out.push(...reconcileProblems(status));

  return out.sort(bySeverity);
}

/** Where the owner approves loading keys (the approval screen lives on Home). */
export const KEY_APPROVAL_ROUTE = "/";

/** Key states that mean "should run in the client but doesn't", other than waiting for approval. */
const NOT_RUNNING: ReadonlySet<ReconcileKeyState> = new Set([
  "elsewhere",
  "import-blocked",
  "missing-keystore",
  "import-failed",
  "retry-limit",
  "deferred",
  "no-client",
]);

function reconcileProblems(s: ReconcileStatus): RpProblem[] {
  // "waiting": no wallet, not registered, daemon starting or syncing; the other banners say so.
  if (s.state === "waiting") return [];
  const out: RpProblem[] = [];
  const name = s.client?.name ?? "your consensus client";
  const details = s.errors.slice(0, 5);
  let errorsShown = false;

  if (!s.client) {
    out.push({
      id: "no-consensus-client",
      tone: "danger",
      title: "No consensus client for your validators",
      body: `${s.clientChoice?.why || s.message || "Rocket Pool could not find the consensus client to load your validator keys into."} Your validators need an installed consensus client (Nimbus, Teku, Lighthouse or Prysm) to run.`,
      action: { label: "Open the DappStore", href: ADMIN_STORE_URL },
    });
    return out;
  }

  const awaiting = s.awaitingApproval.length;
  if (awaiting > 0) {
    out.push({
      id: "keys-awaiting-approval",
      tone: "warning",
      title: `${plural(awaiting, "validator key")} ${awaiting === 1 ? "needs" : "need"} your approval`,
      body: `${awaiting === 1 ? "It is" : "They are"} not loaded in ${name} yet. Load ${awaiting === 1 ? "it" : "them"} only if ${
        awaiting === 1 ? "this validator is" : "these validators are"
      } not running anywhere else: running a key on two machines gets it slashed.`,
      action: { label: "Review keys", to: KEY_APPROVAL_ROUTE },
    });
  }

  const stuck = s.validators.filter((v) => NOT_RUNNING.has(v.state));
  const notRunning = s.validators.length > 0 ? stuck.length : Math.max(0, s.keys.total - s.keys.inSync - awaiting);
  if (notRunning > 0) {
    const elsewhere = stuck.filter((v) => v.state === "elsewhere");
    const where = [...new Set(elsewhere.map((v) => v.loadedIn).filter((p): p is string => !!p))];
    const blocked = stuck.some((v) => v.state === "import-blocked");
    let body = "Rocket Pool tries again every few minutes. If this stays, check the details on the Advanced page.";
    if (elsewhere.length > 0) {
      body = `${plural(elsewhere.length, "key is", "keys are")} loaded in ${where.length ? where.join(", ") : "another consensus client"} instead, so ${
        elsewhere.length === 1 ? "it was" : "they were"
      } not added to ${name} as well (that would get ${elsewhere.length === 1 ? "it" : "them"} slashed). If that is the client you use, choose it as Rocket Pool's consensus client.`;
    } else if (blocked) {
      body = `Another consensus client on this AVADO could not be checked, so nothing was loaded into ${name}, to be safe from double signing. Start or remove that client.`;
    }
    errorsShown = details.length > 0;
    out.push({
      id: "keys-not-loaded",
      tone: "warning",
      title: `${plural(notRunning, "validator key")} not running in ${name}`,
      body,
      details,
      action: { label: "See details", to: "/advanced" },
    });
  }

  if (s.feeRecipients.failed > 0) {
    out.push({
      id: "fee-recipient-failed",
      tone: "warning",
      title: `Fee recipient could not be set for ${plural(s.feeRecipients.failed, "validator")}`,
      body: `${name} could send their block rewards to the wrong address. Rocket Pool tries again every few minutes; if this stays, check the details on the Advanced page.`,
      action: { label: "See details", to: "/advanced" },
    });
  }

  if (s.state === "error") {
    out.push({
      id: "reconcile-failed",
      tone: "warning",
      title: "The validator key check could not run",
      body: s.message || `Rocket Pool could not check your validator keys in ${name}.`,
      details: errorsShown ? [] : details,
      action: { label: "See details", to: "/advanced" },
    });
  } else if (details.length > 0 && !errorsShown) {
    out.push({
      id: "reconcile-errors",
      tone: "warning",
      title: "The validator key check found a problem",
      body: s.message || `Rocket Pool checks every few minutes that your validator keys and fee recipients are right in ${name}.`,
      details,
      action: { label: "See details", to: "/advanced" },
    });
  }
  return out;
}

/** Below this the node wallet may not afford a transaction (a claim or distribute costs ~0.001-0.005 ETH at normal fees). */
export const LOW_GAS_WEI = 10n ** 16n; // 0.01 ETH

/**
 * Node-level problems from `node/status`, for the Home page (they need a
 * Smartnode read, so the shell doesn't poll them).
 */
export function findNodeProblems(node: NodeStatus | null | undefined): RpProblem[] {
  if (!node || !node.registered) return [];
  const out: RpProblem[] = [];
  if (!isZeroAddress(node.primaryWithdrawalAddress) && sameAddress(node.primaryWithdrawalAddress, node.accountAddress)) {
    out.push({
      id: "withdrawal-is-hot-wallet",
      tone: "warning",
      title: "Your withdrawal address is still the node wallet",
      body: "Your staked ETH and rewards go to the withdrawal address. Set it to a wallet you control outside this AVADO (a hardware wallet is best), so they stay safe even if the AVADO is lost.",
      action: { label: "Set withdrawal address", to: "/wallet" },
    });
  }
  const balance = toBigInt(node.accountBalances?.eth);
  if (balance !== null && balance < LOW_GAS_WEI) {
    out.push({
      id: "low-gas-balance",
      tone: "warning",
      title: "Little ETH left for network fees",
      body: `The node wallet has ${formatEth(balance)}. Rocket Pool needs some ETH there to pay network fees for claims and automatic actions. Send at least 0.05 ETH to it.`,
      action: { label: "Open Wallet", to: "/wallet" },
    });
  }
  return out.sort(bySeverity);
}
