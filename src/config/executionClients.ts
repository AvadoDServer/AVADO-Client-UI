/**
 * Execution-engine candidates per network, offered on the Settings page's
 * execution-client picker.
 *
 * The candidates without `clients` are offered to every client. Their list
 * must mirror the `EE_CANDIDATES` case statement in
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
 *
 * Candidates with `clients` are offered to those clients only. Lighthouse has
 * no auto-detection in its start script; its picker offers the engines its
 * previous wizard offered (AVADO-DNP-Lighthouse
 * `build/wizard/src/components/SettingsForm.tsx`): the shared ones plus Reth
 * on mainnet and Nethermind and Reth on Holesky.
 */
import type { ClientName, Network } from "./clientConfig";

export interface ExecutionClientCandidate {
  network: Network;
  /** Package name, matched against DAPPMANAGER's installed-package list. */
  packageName: string;
  /** Plain-language name shown in the picker. */
  name: string;
  /** Short name for sentences and banners ("Geth"), without the network. */
  title: string;
  /** Engine API URL written to `ee_endpoint` when this candidate is picked (startNimbus.sh's `--el=`). */
  eeEndpoint: string;
  /** Only these clients offer this candidate; every client when absent. */
  clients?: ClientName[];
}

export const EXECUTION_CLIENTS: ExecutionClientCandidate[] = [
  // mainnet — startNimbus.sh:21
  {
    network: "mainnet",
    packageName: "ethchain-geth.public.dappnode.eth",
    name: "Geth",
    title: "Geth",
    eeEndpoint: "http://ethchain-geth.my.ava.do:8551",
  },
  {
    network: "mainnet",
    packageName: "avado-dnp-nethermind.public.dappnode.eth",
    name: "Nethermind",
    title: "Nethermind",
    eeEndpoint: "http://avado-dnp-nethermind.my.ava.do:8551",
  },
  // prater (Goerli testnet) — startNimbus.sh:24
  {
    network: "prater",
    packageName: "goerli-geth.avado.dnp.dappnode.eth",
    name: "Geth (Goerli testnet)",
    title: "Geth",
    eeEndpoint: "http://goerli-geth.my.ava.do:8551",
  },
  {
    network: "prater",
    packageName: "nethermind-goerli.avado.dnp.dappnode.eth",
    name: "Nethermind (Goerli testnet)",
    title: "Nethermind",
    eeEndpoint: "http://nethermind-goerli.my.ava.do:8551",
  },
  // holesky testnet — startNimbus.sh:27
  {
    network: "holesky",
    packageName: "holesky-geth.avado.dnp.dappnode.eth",
    name: "Geth (Holesky testnet)",
    title: "Geth",
    eeEndpoint: "http://holesky-geth.my.ava.do:8551",
  },
  // Lighthouse only — its previous wizard's execution-engine list
  {
    network: "mainnet",
    packageName: "reth-mainnet.avado.dnp.dappnode.eth",
    name: "Reth",
    title: "Reth",
    eeEndpoint: "http://reth-mainnet.my.ava.do:8551",
    clients: ["lighthouse"],
  },
  {
    network: "holesky",
    packageName: "nethermind-holesky.avado.dnp.dappnode.eth",
    name: "Nethermind (Holesky testnet)",
    title: "Nethermind",
    eeEndpoint: "http://nethermind-holesky.my.ava.do:8551",
    clients: ["lighthouse"],
  },
  {
    network: "holesky",
    packageName: "reth-holesky.avado.dnp.dappnode.eth",
    name: "Reth (Holesky testnet)",
    title: "Reth",
    eeEndpoint: "http://reth-holesky.my.ava.do:8551",
    clients: ["lighthouse"],
  },
  // gnosis — startNimbus.sh:30
  {
    network: "gnosis",
    packageName: "nethermind-gnosis.avado.dnp.dappnode.eth",
    name: "Nethermind",
    title: "Nethermind",
    eeEndpoint: "http://nethermind-gnosis.my.ava.do:8551",
  },
];

/**
 * The candidates one client offers on one network, in the order shown to the
 * owner. Without a client, only the candidates every client offers.
 */
export function executionClientsForNetwork(network: Network, client?: ClientName): ExecutionClientCandidate[] {
  return EXECUTION_CLIENTS.filter(
    (c) => c.network === network && (!c.clients || (client !== undefined && c.clients.includes(client))),
  );
}

/** Look up a candidate by package name, regardless of network. */
export function findExecutionClient(packageName: string | undefined): ExecutionClientCandidate | undefined {
  if (!packageName) return undefined;
  return EXECUTION_CLIENTS.find((c) => c.packageName === packageName);
}

/**
 * A short, friendly name for an execution-client package: the known title,
 * else a guess from the package name (`besu.public.dappnode.eth` → "Besu").
 */
export function executionClientTitle(packageName: string): string {
  const known = findExecutionClient(packageName);
  if (known) return known.title;
  const first = packageName.split(".")[0] ?? packageName;
  const guess = ["geth", "nethermind", "besu", "erigon", "reth"].find((n) => first.includes(n)) ?? first;
  return guess.charAt(0).toUpperCase() + guess.slice(1);
}
