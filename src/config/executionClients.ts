/**
 * Execution-engine candidates per network, offered on the Settings page's
 * execution-client picker.
 *
 * This list must mirror the `EE_CANDIDATES` case statement in
 * `AVADO-DNP-Nimbus/build/startNimbus.sh:19-35`, which the entrypoint uses to
 * auto-detect (fresh install) or fail over (existing install, only when the
 * configured engine's hostname stops resolving and exactly one other
 * candidate answers) the execution engine on boot. The two lists are
 * independent hardcoded copies (nimbus.md §5) — there is no shared source of
 * truth, so a future change to the script's candidates must be copied here
 * by hand, and vice versa.
 *
 * Networks with no case in the script (`hoodi`, and any future network) get
 * an empty candidate list here too, matching the script's `*) EE_CANDIDATES=""`
 * fallback.
 */
import type { Network } from "./clientConfig";

export interface ExecutionClientCandidate {
  network: Network;
  /** Package name, matched against DAPPMANAGER's installed-package list. */
  packageName: string;
  /** Plain-language name shown in the picker. */
  name: string;
  /** Engine API URL written to `ee_endpoint` when this candidate is picked (startNimbus.sh's `--el=`). */
  eeEndpoint: string;
}

export const EXECUTION_CLIENTS: ExecutionClientCandidate[] = [
  // mainnet — startNimbus.sh:21
  {
    network: "mainnet",
    packageName: "ethchain-geth.public.dappnode.eth",
    name: "Geth",
    eeEndpoint: "http://ethchain-geth.my.ava.do:8551",
  },
  {
    network: "mainnet",
    packageName: "avado-dnp-nethermind.public.dappnode.eth",
    name: "Nethermind",
    eeEndpoint: "http://avado-dnp-nethermind.my.ava.do:8551",
  },
  // prater (Goerli testnet) — startNimbus.sh:24
  {
    network: "prater",
    packageName: "goerli-geth.avado.dnp.dappnode.eth",
    name: "Geth (Goerli testnet)",
    eeEndpoint: "http://goerli-geth.my.ava.do:8551",
  },
  {
    network: "prater",
    packageName: "nethermind-goerli.avado.dnp.dappnode.eth",
    name: "Nethermind (Goerli testnet)",
    eeEndpoint: "http://nethermind-goerli.my.ava.do:8551",
  },
  // holesky testnet — startNimbus.sh:27
  {
    network: "holesky",
    packageName: "holesky-geth.avado.dnp.dappnode.eth",
    name: "Geth (Holesky testnet)",
    eeEndpoint: "http://holesky-geth.my.ava.do:8551",
  },
  // gnosis — startNimbus.sh:30
  {
    network: "gnosis",
    packageName: "nethermind-gnosis.avado.dnp.dappnode.eth",
    name: "Nethermind",
    eeEndpoint: "http://nethermind-gnosis.my.ava.do:8551",
  },
];

/** The candidates offered for one network, in the order shown to the owner. */
export function executionClientsForNetwork(network: Network): ExecutionClientCandidate[] {
  return EXECUTION_CLIENTS.filter((c) => c.network === network);
}

/** Look up a candidate by package name, regardless of network. */
export function findExecutionClient(packageName: string | undefined): ExecutionClientCandidate | undefined {
  if (!packageName) return undefined;
  return EXECUTION_CLIENTS.find((c) => c.packageName === packageName);
}
