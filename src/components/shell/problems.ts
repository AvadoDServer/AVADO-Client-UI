import type { Settings } from "../../api/types";
import { NETWORKS, type ClientName, type Network } from "../../config/clientConfig";
import { CLIENT_TITLE, NETWORK_TITLE, TEST_NETWORKS } from "./identity";
import { executionCandidates } from "./executionCandidates";
import { ADMIN_STORE_URL, adminPackageUrl } from "./links";

/**
 * The problem banners (spec §4). Pure rules over what the shell has loaded;
 * anything not loaded yet (undefined/null) never raises a problem.
 */

export type ProblemId =
  | "wrong-config"
  | "unknown-network"
  | "no-execution-client"
  | "execution-client-not-installed"
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
  /** Installed package names from DAPPMANAGER. */
  packages?: string[] | null;
  /** `syncing.el_offline` from the beacon node. */
  elOffline?: boolean;
}

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
        ? `The ${name} settings are for ${NETWORK_TITLE[settingsNetwork]}, but this package runs on ${NETWORK_TITLE[i.network]}.`
        : `The ${name} settings name a network this page doesn't know: "${settingsNetwork}".`,
      action: { label: "Open the package", href: packagePage },
    });
  }

  const packages = i.packages;
  const engine = typeof i.settings?.execution_engine === "string" ? i.settings.execution_engine : "";
  let executionProblem = false;
  if (packages) {
    const candidates = executionCandidates(i.network);
    const installed = candidates.filter((c) => packages.includes(c));
    if (candidates.length > 0 && installed.length === 0) {
      executionProblem = true;
      out.push({
        id: "no-execution-client",
        tone: "danger",
        title: "No execution client installed",
        body: `${name} needs an execution client to follow the chain and propose blocks. Install one from the DappStore.`,
        action: { label: "Install an execution client", href: ADMIN_STORE_URL },
      });
    } else if (i.settings && engine && !packages.includes(engine)) {
      executionProblem = true;
      out.push({
        id: "execution-client-not-installed",
        tone: "warning",
        title: "The chosen execution client is not installed",
        body: `${name} is set to use ${engine}, which is not installed. Choose an installed one in settings.`,
        action: { label: "Choose in settings", to: "/settings" },
      });
    }
  }

  if (i.elOffline && !executionProblem) {
    out.push({
      id: "execution-client-offline",
      tone: "warning",
      title: "Execution client not reachable",
      body: `${name} can't reach its execution client. It may still be starting; if this stays, check the execution client.`,
      action: engine ? { label: "Open execution client", href: adminPackageUrl(engine) } : { label: "Check settings", to: "/settings" },
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
    out.push({
      id: "testnet",
      tone: "accent",
      title: `${NETWORK_TITLE[i.network]} test network`,
      body: "Validators on a test network don't earn real ETH.",
      action: { label: "Find the mainnet version", href: ADMIN_STORE_URL },
    });
  }

  return out;
}
