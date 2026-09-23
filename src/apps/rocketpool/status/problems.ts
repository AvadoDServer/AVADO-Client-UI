/**
 * The Rocket Pool app's problem banners: pure rules over what the shell has
 * loaded from `/api/avado/status` and `/api/avado/reconcile`. Anything not
 * loaded yet never raises a problem. Most serious first.
 */
import { ADMIN_STORE_URL, adminPackageUrl } from "../../../components/shell/links";
import type { Problem, ProblemTone } from "../../../components/shell/problems";
import type { AvadoStatus, NodeStatus, ReconcileStatus, ReconcileView } from "../api/models";
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
  | "keys-not-loaded"
  | "fee-recipient-wrong"
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

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The reconcile loop's status file, checked field by field: anything missing
 * or of the wrong type is left out, so an older or partial file never breaks
 * the banners.
 */
export function parseReconcileStatus(raw: unknown): ReconcileStatus | undefined {
  if (!isObject(raw)) return undefined;
  const out: ReconcileStatus = {};
  if (str(raw.lastRunAt)) out.lastRunAt = raw.lastRunAt as string;
  if (raw.client === null) out.client = null;
  else if (isObject(raw.client) && str(raw.client.package)) {
    out.client = { package: raw.client.package as string, title: str(raw.client.title) ?? (raw.client.package as string) };
  }
  if (isObject(raw.keys)) {
    const total = num(raw.keys.total);
    const loaded = num(raw.keys.loaded);
    if (total !== undefined && loaded !== undefined) {
      out.keys = { total, loaded };
      if (num(raw.keys.imported) !== undefined) out.keys.imported = raw.keys.imported as number;
      if (num(raw.keys.inOtherClient) !== undefined) out.keys.inOtherClient = raw.keys.inOtherClient as number;
    }
  }
  if (isObject(raw.feeRecipients)) {
    const total = num(raw.feeRecipients.total);
    const correct = num(raw.feeRecipients.correct);
    if (total !== undefined && correct !== undefined) {
      out.feeRecipients = { total, correct };
      if (num(raw.feeRecipients.fixed) !== undefined) out.feeRecipients.fixed = raw.feeRecipients.fixed as number;
    }
  }
  if (Array.isArray(raw.errors)) out.errors = raw.errors.filter((e): e is string => typeof e === "string" && e.trim() !== "");
  return out;
}

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
  const status = reconcile?.available ? parseReconcileStatus(reconcile.status) : undefined;
  if (status && ready && avado.walletFilePresent) out.push(...reconcileProblems(status));

  return out.sort(bySeverity);
}

function reconcileProblems(s: ReconcileStatus): RpProblem[] {
  const out: RpProblem[] = [];
  const errors = s.errors ?? [];
  const keys = s.keys;
  const clientTitle = s.client?.title ?? "your consensus client";
  let errorsShown = false;

  if (s.client === null && (keys?.total ?? 0) > 0) {
    out.push({
      id: "no-consensus-client",
      tone: "danger",
      title: "No consensus client installed",
      body: "Your Rocket Pool validators need a consensus client (Nimbus, Teku, Lighthouse or Prysm) to run. Install one from the DappStore; the keys are added to it automatically.",
      action: { label: "Open the DappStore", href: ADMIN_STORE_URL },
    });
    return out;
  }

  if (keys && keys.loaded < keys.total) {
    const missing = keys.total - keys.loaded;
    const elsewhere = keys.inOtherClient ?? 0;
    errorsShown = errors.length > 0;
    out.push({
      id: "keys-not-loaded",
      tone: "warning",
      title: `${plural(missing, "validator key")} not running in ${clientTitle}`,
      body:
        elsewhere > 0
          ? `${plural(elsewhere, "key is", "keys are")} already loaded in another consensus client on this AVADO, so ${elsewhere === 1 ? "it was" : "they were"} not added again (that would risk double signing).`
          : "Rocket Pool adds them automatically every few minutes. If this stays, check the details on the Advanced page.",
      details: errors.slice(0, 5),
      action: { label: "See details", to: "/advanced" },
    });
  }

  if (s.feeRecipients && s.feeRecipients.correct < s.feeRecipients.total) {
    const wrong = s.feeRecipients.total - s.feeRecipients.correct;
    out.push({
      id: "fee-recipient-wrong",
      tone: "warning",
      title: `Wrong fee recipient for ${plural(wrong, "validator")}`,
      body: `${clientTitle === "your consensus client" ? "Your consensus client" : clientTitle} would send their block rewards to the wrong address. It is corrected automatically every few minutes; if this stays, check the details on the Advanced page.`,
      action: { label: "See details", to: "/advanced" },
    });
  }

  if (errors.length > 0 && !errorsShown) {
    out.push({
      id: "reconcile-errors",
      tone: "warning",
      title: "The validator key check found a problem",
      body: `Rocket Pool checks every few minutes that your validator keys and fee recipients are right in ${clientTitle}.`,
      details: errors.slice(0, 5),
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
