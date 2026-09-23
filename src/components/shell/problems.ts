import type { PackageState, Settings } from "../../api/types";
import { NETWORKS, type ClientName, type Network } from "../../config/clientConfig";
import { CLIENT_TITLE, NETWORK_TITLE, TEST_NETWORKS } from "./identity";
import { executionClientsForNetwork, executionClientTitle } from "../../config/executionClients";
import { ADMIN_STORE_URL, adminInstallerUrl, adminPackageUrl } from "./links";

/** "Geth", "Geth or Nethermind", "Geth, Besu or Nethermind". */
export function orList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/**
 * The problem banners (spec §4). Pure rules over what the shell has loaded;
 * anything not loaded yet (undefined/null) never raises a problem.
 */

export type ProblemId =
  | "wrong-config"
  | "unknown-network"
  | "no-execution-client"
  | "execution-client-not-installed"
  | "execution-client-stopped"
  | "execution-client-offline"
  | "fee-recipient"
  | "testnet";

export type ProblemTone = "danger" | "warning" | "accent";

/** A fix: an in-app route (`to`) or a link elsewhere on the box (`href`). */
export interface ProblemAction {
  label: string;
  to?: string;
  href?: string;
}

export interface Problem {
  id: ProblemId;
  tone: ProblemTone;
  title: string;
  body: string;
  details?: string[];
  action: ProblemAction;
}

export interface ProblemInputs {
  client: ClientName;
  network: Network;
  packageName: string;
  /** `useClientConfigStatus().problems` */
  configProblems: string[];
  settings?: Settings | null;
  /** Installed packages (running or stopped) from DAPPMANAGER. */
  packages?: PackageState[] | null;
  /** `syncing.el_offline` from the beacon node. */
  elOffline?: boolean;
}

/** Test networks that no longer run. */
const SHUT_DOWN_NETWORKS: readonly Network[] = ["prater"];

const RESTART_HINT = "Restart the package from its page in the AVADO Admin. If this stays, contact AVADO support.";

const isKnownNetwork = (n: string): n is Network => (NETWORKS as readonly string[]).includes(n);

export function findProblems(i: ProblemInputs): Problem[] {
  const out: Problem[] = [];
  const name = CLIENT_TITLE[i.client];
  const packagePage = adminPackageUrl(i.packageName);

  if (i.configProblems.length > 0) {
    out.push({
      id: "wrong-config",
      tone: "danger",
      title: "Wrong configuration",
      body: `This page could not read its setup, so it assumes ${name} on ${NETWORK_TITLE[i.network]}. Some parts may not work. Updating or restarting the package usually fixes this.`,
      details: [...i.configProblems],
      action: { label: "Open the package", href: packagePage },
    });
  }

  const settingsNetwork = i.settings?.network;
  if (typeof settingsNetwork === "string" && settingsNetwork !== i.network) {
    out.push({
      id: "unknown-network",
      tone: "danger",
      title: "Wrong configuration",
      body: isKnownNetwork(settingsNetwork)
        ? `The ${name} settings are for ${NETWORK_TITLE[settingsNetwork]}, but this package runs on ${NETWORK_TITLE[i.network]}. ${RESTART_HINT}`
        : `The ${name} settings name a network this page doesn't know: "${settingsNetwork}". ${RESTART_HINT}`,
      action: { label: "Open the package", href: packagePage },
    });
  }

  const engine = typeof i.settings?.execution_engine === "string" ? i.settings.execution_engine : "";
  let executionProblem = false;
  if (i.packages) {
    const states = new Map(i.packages.map((p) => [p.name, p.running]));
    const installed = (n: string) => states.has(n);
    const candidates = executionClientsForNetwork(i.network);
    const installedCandidates = candidates.filter((c) => installed(c.packageName));
    if (candidates.length > 0 && installedCandidates.length === 0) {
      executionProblem = true;
      const only = candidates.length === 1 ? candidates[0] : undefined;
      out.push({
        id: "no-execution-client",
        tone: "danger",
        title: "No execution client installed",
        body: `${name} needs an execution client to follow the chain and propose blocks. Install ${orList(candidates.map((c) => c.title))} from the DappStore.`,
        action: only
          ? { label: `Install ${only.title}`, href: adminInstallerUrl(only.packageName) }
          : { label: "Install an execution client", href: ADMIN_STORE_URL },
      });
    } else if (i.settings && engine && !installed(engine)) {
      executionProblem = true;
      const choices = installedCandidates.map((c) => c.title);
      out.push({
        id: "execution-client-not-installed",
        tone: "warning",
        title: "The chosen execution client is not installed",
        body: `${name} is set to use ${executionClientTitle(engine)}, which is not installed. ${
          choices.length > 0 ? `Choose ${orList(choices)} in settings.` : "Choose an installed one in settings."
        }`,
        action: { label: "Choose in settings", to: "/settings" },
      });
    } else {
      // The engine this client uses: the chosen one, else any installed candidate.
      const relevant = engine && installed(engine) ? [engine] : installedCandidates.map((c) => c.packageName);
      if (relevant.length > 0 && relevant.every((n) => states.get(n) === false)) {
        executionProblem = true;
        const title = executionClientTitle(relevant[0]);
        out.push({
          id: "execution-client-stopped",
          tone: "danger",
          title: `${title} is stopped`,
          body: `${title} is installed but not running, so ${name} can't follow the chain. Start it from its page in the AVADO Admin.`,
          action: { label: `Open ${title}`, href: adminPackageUrl(relevant[0]) },
        });
      }
    }
  }

  if (i.elOffline && !executionProblem) {
    const title = engine ? executionClientTitle(engine) : "";
    out.push({
      id: "execution-client-offline",
      tone: "warning",
      title: "Execution client not reachable",
      body: `${name} can't reach ${title || "its execution client"}. It may still be starting; if this stays, check it in the AVADO Admin.`,
      action: engine ? { label: `Open ${title}`, href: adminPackageUrl(engine) } : { label: "Check settings", to: "/settings" },
    });
  }

  if (i.settings) {
    const fee = i.settings.validators_proposer_default_fee_recipient;
    if (typeof fee !== "string" || fee.trim() === "") {
      out.push({
        id: "fee-recipient",
        tone: "warning",
        title: "No fee recipient set",
        body: "Set the address that receives your block rewards and tips. Without it you miss out on rewards.",
        action: { label: "Set fee recipient", to: "/settings?focus=fee-recipient" },
      });
    }
  }

  if (TEST_NETWORKS.includes(i.network)) {
    const shutDown = SHUT_DOWN_NETWORKS.includes(i.network);
    out.push({
      id: "testnet",
      tone: shutDown ? "warning" : "accent",
      title: `${NETWORK_TITLE[i.network]} test network`,
      body: shutDown
        ? `The ${NETWORK_TITLE[i.network]} (Goerli) test network has been shut down, so validators here no longer do anything.`
        : "Validators on a test network don't earn real ETH.",
      action: { label: "Find the mainnet version", href: ADMIN_STORE_URL },
    });
  }

  return out;
}
