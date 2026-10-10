/**
 * The Rocket Pool app's problem banners: pure rules over what the shell has
 * loaded from `/api/avado/status` and `/api/avado/reconcile`. Anything not
 * loaded yet never raises a problem. Most serious first.
 */
import { ADMIN_STORE_URL, adminPackageUrl } from "../../../components/shell/links";
import type { Problem, ProblemAction, ProblemTone } from "../../../components/shell/problems";
import { plainMessage } from "../api/errors";
import type { AvadoStatus, NodeStatus, ReconcileKeyState, ReconcileStatus, ReconcileView } from "../api/models";
import { reconcileStatusOf } from "../api/reconcile";
import { txUrl } from "../lib/explorer";
import { formatEth, isZeroAddress, sameAddress, shortAddress, toBigInt } from "../lib/units";
import type { PendingTx } from "../tx/pending";

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
  | "keys-loaded-twice"
  | "keys-awaiting-approval"
  | "keys-settling"
  | "keys-not-loaded"
  | "fee-recipient-failed"
  | "reconcile-failed"
  | "reconcile-errors"
  | "reconcile-newer"
  | "tx-unclear"
  | "tx-on-its-way"
  | "withdrawal-is-hot-wallet"
  | "low-gas-balance";

/**
 * A banner. `techDetails` (raw log lines, the key check's own errors) show
 * only in Advanced mode; `simpleAction` replaces the action in Simple mode
 * when the Advanced one leads to logs and settings a home staker can't use.
 */
export type RpProblem = Problem<RpProblemId> & { techDetails?: string[]; simpleAction?: ProblemAction };

/** The banner as shown in the current mode. */
export function forMode(p: RpProblem, advanced: boolean): Problem<RpProblemId> {
  const { techDetails, simpleAction, ...rest } = p;
  if (advanced) return { ...rest, details: [...(rest.details ?? []), ...(techDetails ?? [])] };
  return { ...rest, action: simpleAction ?? rest.action };
}

const CONTACT_SUPPORT: ProblemAction = { label: "Contact AVADO support", href: `mailto:${SUPPORT_EMAIL}` };

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
        body: "It may be restarting after an update: wait a minute. If this lasts more than a few minutes, restart the package in the AVADO Admin.",
        action: { label: "Open the package", href: packagePage },
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
      title: "Wrong network",
      body: `This package works on the main Ethereum network only, but it is set to "${avado.network}", so Rocket Pool won't start. Contact AVADO support to fix this.`,
      action: CONTACT_SUPPORT,
    });
  }

  if (avado.startupError) {
    out.push({
      id: "startup-error",
      tone: "danger",
      title: "Rocket Pool could not start",
      body: `${plainMessage(avado.startupError) || "Something went wrong while it was starting."} Your wallet and validator keys are safe. Restarting the package in the AVADO Admin often fixes this; if it doesn't, contact AVADO support.`,
      techDetails: [avado.startupError, ...lastLines(avado.daemonErrors)],
      action: { label: "See the logs", to: "/advanced" },
      simpleAction: { label: "Open the package", href: packagePage },
    });
  } else if (stopped) {
    out.push({
      id: "daemon-stopped",
      tone: "danger",
      title: "Rocket Pool has stopped",
      body: "Your node isn't doing its Rocket Pool work while it is stopped. Restart the package in the AVADO Admin; if it stops again, contact AVADO support.",
      techDetails: lastLines(avado.daemonErrors),
      action: { label: "Open the package", href: packagePage },
    });
  }

  const running = state === "RUNNING";
  const ready = running && avado.apiReachable && avado.apiTokenPresent;
  if (!stopped && !avado.startupError && !ready && (state === "STARTING" || running)) {
    out.push({
      id: "daemon-starting",
      tone: "accent",
      title: "Rocket Pool is starting",
      body: "This can take a few minutes after a restart or an update. The page fills in by itself once it's ready: there is nothing you need to do.",
      action: { label: "See the logs", to: "/advanced" },
      simpleAction: { label: "Go to Home", to: "/" },
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
      title: "The node wallet can't be unlocked",
      body: "The file with the node wallet's password is missing, so Rocket Pool can't use the wallet or send transactions. Don't change anything yourself: contact AVADO support.",
      action: CONTACT_SUPPORT,
    });
  }

  if (avado.legacyMnemonicPresent) {
    out.push({
      id: "legacy-mnemonic",
      tone: "warning",
      title: "Your recovery phrase is saved in an unprotected file",
      body: "The old version of this package saved your recovery phrase as plain text on this AVADO. Make sure you have the words on paper, then move the file into the backups.",
      action: { label: "Fix this", to: LEGACY_MNEMONIC_ROUTE },
    });
  }

  // Validator keys: only meaningful while the daemon runs and a wallet exists.
  const status = reconcileStatusOf(reconcile);
  if (status) {
    const found = reconcileProblems(status);
    // A key loaded twice is danger whatever the daemon is doing; the rest only means something while it runs.
    out.push(...(ready && avado.walletFilePresent ? found : found.filter((p) => p.id === "keys-loaded-twice")));
  }

  return out.sort(bySeverity);
}

/** Where the owner approves loading keys (the approval screen lives on Home). */
export const KEY_APPROVAL_ROUTE = "/";
/** Where the old plaintext recovery-phrase file is explained and moved away (Home). */
export const LEGACY_MNEMONIC_ROUTE = "/";
/** The setup wizard's steps that fix node problems. */
export const SETUP_WITHDRAWAL_ROUTE = "/setup/withdrawal";
export const SETUP_FUND_ROUTE = "/setup/fund";
/** Rocket Pool's site, where a new withdrawal address confirms itself from its own wallet. */
export const CONFIRM_WITHDRAWAL_URL = "https://node.rocketpool.net/primary-withdrawal-address";

/** Key states that mean "should run in the client but doesn't", other than waiting for approval or settling. */
const NOT_RUNNING: ReadonlySet<ReconcileKeyState> = new Set([
  "elsewhere",
  "import-blocked",
  "client-update-needed",
  "missing-keystore",
  "import-failed",
  "retry-limit",
  "deferred",
  "no-client",
  "unknown",
]);

const shortKey = (pk: string) => `0x${pk.slice(0, 8)}…${pk.slice(-4)}`;

const timeOf = (iso: string | undefined): string | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
};

function reconcileProblems(s: ReconcileStatus): RpProblem[] {
  const out: RpProblem[] = [];
  const name = s.client?.name ?? "your consensus client";
  const details = s.errors.slice(0, 5);
  let errorsShown = false;

  // Slashing danger comes first, whatever else the pass says, and stays until the key is removed from one client.
  if (s.loadedTwice.length > 0) {
    const n = s.loadedTwice.length;
    out.push({
      id: "keys-loaded-twice",
      tone: "danger",
      title: n === 1 ? "A validator key is loaded in two clients — this can get it slashed" : `${n} validator keys are loaded in two clients — this can get them slashed`,
      body: `Slashing is a heavy penalty: it takes part of your ETH and forces the validator out. Remove ${n === 1 ? "the key" : "the keys"} from one of the clients now. Rocket Pool never removes keys itself; Home shows where ${n === 1 ? "it is" : "they are"}.`,
      details: s.loadedTwice.slice(0, 5).map((t) => `${shortKey(t.pubkey)}: ${t.packages.join(" and ") || "two clients"}`),
      action: { label: "See details", to: "/advanced" },
      simpleAction: { label: "Show me where", to: KEY_APPROVAL_ROUTE },
    });
  }

  // "waiting": no wallet, not registered, daemon starting or syncing; the other banners say so.
  if (s.state === "waiting") return out;

  // Only when the pass got as far as choosing a client: an earlier failure (node status unreadable) is reported below.
  if (!s.client && s.clientChoice) {
    out.push({
      id: "no-consensus-client",
      tone: "danger",
      title: "Your validators have no consensus client",
      body: `${s.clientChoice?.why && plainMessage(s.clientChoice.why) ? `${plainMessage(s.clientChoice.why)} ` : ""}Your validators run inside a consensus client, one of the two Ethereum programs on your AVADO. Install Nimbus, Teku, Lighthouse or Prysm from the DappStore.`,
      techDetails: s.message ? [s.message] : [],
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
      body: `${awaiting === 1 ? "It is" : "They are"} not running in ${name} yet. Start ${awaiting === 1 ? "it" : "them"} only if ${
        awaiting === 1 ? "this validator is" : "these validators are"
      } not running anywhere else: running a key on two machines gets it slashed (a heavy penalty).`,
      details: s.importBlockedReasons.slice(0, 5).map(plainMessage).filter(Boolean),
      action: { label: "Review keys", to: KEY_APPROVAL_ROUTE },
    });
  }

  const settling = s.validators.filter((v) => v.state === "settling");
  if (settling.length > 0) {
    const times = settling.map((v) => timeOf(v.settlesAt)).filter((t): t is string => !!t).sort();
    out.push({
      id: "keys-settling",
      tone: "accent",
      title: `${plural(settling.length, "validator key")} will start soon`,
      body: `To be safe, Rocket Pool first waits to make sure ${
        settling.length === 1 ? "it isn't" : "they aren't"
      } running anywhere else${times.length ? `. ${settling.length === 1 ? "It starts" : "They start"} at about ${times[times.length - 1]}` : ""}. Nothing to do.`,
      action: { label: "See details", to: "/advanced" },
      simpleAction: { label: "See on Home", to: KEY_APPROVAL_ROUTE },
    });
  }

  const stuck = s.validators.filter((v) => NOT_RUNNING.has(v.state));
  const counted = s.validators.length > 0;
  const notRunning = counted ? stuck.length : Math.max(0, s.keys.total - s.keys.inSync - awaiting);
  if (notRunning > 0) {
    const elsewhere = stuck.filter((v) => v.state === "elsewhere");
    const where = [...new Set(elsewhere.flatMap((v) => v.loadedIn))];
    const blocked = stuck.some((v) => v.state === "import-blocked");
    const update = stuck.some((v) => v.state === "client-update-needed");
    let body = "They aren't validating right now. Rocket Pool tries again every few minutes by itself. If this lasts more than an hour, contact AVADO support.";
    if (elsewhere.length > 0) {
      body = `${plural(elsewhere.length, "key is", "keys are")} loaded in ${where.length ? where.join(", ") : "another consensus client"} instead, so ${
        elsewhere.length === 1 ? "it was" : "they were"
      } not added to ${name} as well (that would get ${elsewhere.length === 1 ? "it" : "them"} slashed). If that is the client you use, choose it as Rocket Pool's consensus client.`;
    } else if (update) {
      body = `Update ${name} in the AVADO Admin: this version can't have keys loaded into it safely. Rocket Pool loads them after the update.`;
    } else if (blocked) {
      body = `Another consensus client on this AVADO couldn't be checked, so to be safe nothing was loaded into ${name}. Start that other client, or remove it if you don't use it.`;
    }
    errorsShown = details.length > 0;
    out.push({
      id: "keys-not-loaded",
      tone: "warning",
      title: `${plural(notRunning, "validator key")} not running in ${name}`,
      body,
      details: s.importBlockedReasons.slice(0, 5).map(plainMessage).filter(Boolean),
      techDetails: details,
      action: { label: "See details", to: "/advanced" },
      simpleAction: update && s.client ? { label: `Open ${name}`, href: adminPackageUrl(s.client.package) } : CONTACT_SUPPORT,
    });
  }

  if (s.feeRecipients.failed > 0) {
    out.push({
      id: "fee-recipient-failed",
      tone: "warning",
      title: `Block rewards may go to the wrong address for ${plural(s.feeRecipients.failed, "validator")}`,
      body: `Rocket Pool couldn't set where ${name} pays these validators' block rewards (the "fee recipient"). It tries again every few minutes by itself. If this lasts more than an hour, contact AVADO support.`,
      action: { label: "See details", to: "/advanced" },
      simpleAction: CONTACT_SUPPORT,
    });
  }

  if (s.state === "error" && s.loadedTwice.length === 0) {
    out.push({
      id: "reconcile-failed",
      tone: "danger",
      title: "Rocket Pool couldn't check your validators",
      body: `Every few minutes Rocket Pool checks that your validators run in ${name}. The last check failed; it tries again by itself. If this lasts more than an hour, contact AVADO support.`,
      techDetails: [s.message, ...(errorsShown ? [] : details)].filter((t): t is string => !!t),
      action: { label: "See details", to: "/advanced" },
      simpleAction: CONTACT_SUPPORT,
    });
  } else if (details.length > 0 && !errorsShown && s.state !== "error") {
    out.push({
      id: "reconcile-errors",
      tone: "warning",
      title: "Rocket Pool found a problem with your validators",
      body: `Rocket Pool checks every few minutes that your validators run in ${name} and pay their rewards to the right place. It tries to fix this by itself. If this lasts more than an hour, contact AVADO support.`,
      techDetails: [s.message, ...details].filter((t): t is string => !!t),
      action: { label: "See details", to: "/advanced" },
      simpleAction: CONTACT_SUPPORT,
    });
  }

  if (s.newerThanUi && out.length === 0 && s.state !== "ok") {
    out.push({
      id: "reconcile-newer",
      tone: "warning",
      title: "Check your validators",
      body: "Rocket Pool reported something this page can't show yet. Reload the page; if this stays, contact AVADO support.",
      techDetails: s.message ? [s.message] : [],
      action: { label: "See details", to: "/advanced" },
      simpleAction: CONTACT_SUPPORT,
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
    const pending = isZeroAddress(node.pendingPrimaryWithdrawalAddress) ? null : node.pendingPrimaryWithdrawalAddress;
    out.push(
      pending
        ? {
            id: "withdrawal-is-hot-wallet",
            tone: "warning",
            title: "Confirm your new withdrawal address",
            body: `Your withdrawal address is the wallet your staked ETH and rewards are paid to. ${shortAddress(pending)} still has to confirm it: open the Rocket Pool website with that wallet and confirm. Until then, everything still goes to the node wallet.`,
            action: { label: "How to confirm", to: SETUP_WITHDRAWAL_ROUTE },
          }
        : {
            id: "withdrawal-is-hot-wallet",
            tone: "warning",
            title: "Your withdrawal address is still the node wallet",
            body: "Your withdrawal address is the wallet your staked ETH and rewards are paid to. Set it to a wallet you control outside this AVADO (a hardware wallet is best), so they stay safe even if the AVADO is lost.",
            action: { label: "Set withdrawal address", to: SETUP_WITHDRAWAL_ROUTE },
          },
    );
  }
  const balance = toBigInt(node.accountBalances?.eth);
  if (balance !== null && balance < LOW_GAS_WEI) {
    out.push({
      id: "low-gas-balance",
      tone: "warning",
      title: "Little ETH left for network fees",
      body: `The node wallet has ${formatEth(balance)}. Rocket Pool pays network fees from it, for your claims and for what it does automatically. Send at least 0.05 ETH to it.`,
      action: { label: "Add ETH", to: SETUP_FUND_ROUTE },
    });
  }
  return out.sort(bySeverity);
}

/**
 * Banners for the app's own transactions (the pending-transaction store): one
 * for any whose outcome is unclear, one for any still on their way. They show
 * on every page, also after a reload, until the transaction is settled.
 */
export function findPendingProblems(list: PendingTx[], isOverdue: (key: string) => boolean = () => false): RpProblem[] {
  const out: RpProblem[] = [];
  // Not mined for an hour counts as unclear: the owner has to decide.
  const unclear = list.filter((e) => e.state === "unknown" || e.state === "lost" || (e.state === "sent" && isOverdue(e.key)));
  const moving = list.filter((e) => (e.state === "sending" || e.state === "sent") && !unclear.includes(e));
  const link = (e: PendingTx) => {
    const href = e.txHash ? txUrl(e.txHash) : null;
    return href ? { label: "View on Etherscan", href } : { label: "Open", to: e.page };
  };
  if (unclear.length > 0) {
    const one = unclear[0];
    out.push({
      id: "tx-unclear",
      tone: "warning",
      title: unclear.length === 1 ? `Check your transaction: ${one.title}` : `${unclear.length} transactions need checking`,
      body: "It isn't known yet whether it went through. Don't start it again until you've checked it: the same action stays locked until then.",
      details: unclear.length > 1 ? unclear.map((e) => e.title) : [],
      action: unclear.length === 1 ? link(one) : { label: "Open", to: one.page },
    });
  }
  if (moving.length > 0) {
    const one = moving[0];
    out.push({
      id: "tx-on-its-way",
      tone: "accent",
      title: moving.length === 1 ? `Transaction on its way: ${one.title}` : `${moving.length} transactions on their way`,
      body: "It is waiting to be confirmed by the network, usually within a minute. This page keeps following it.",
      details: moving.length > 1 ? moving.map((e) => e.title) : [],
      action: link(one),
    });
  }
  return out;
}
