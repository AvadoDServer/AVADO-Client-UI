import type { Network } from "../../config/clientConfig";

/**
 * Execution-client packages per network, as in
 * AVADO-DNP-Nimbus/build/startNimbus.sh:19-35 (EE_CANDIDATES).
 *
 * TEMPORARY: Task 5 owns `src/config/executionClients.ts` with the full
 * candidate list (package, endpoint, name). At merge, derive this from that
 * file and delete this one.
 */
export interface ExecutionCandidate {
  packageName: string;
  /** Friendly name for owners. */
  title: string;
}

export const EXECUTION_CANDIDATES: Partial<Record<Network, ExecutionCandidate[]>> = {
  mainnet: [
    { packageName: "ethchain-geth.public.dappnode.eth", title: "Geth" },
    { packageName: "avado-dnp-nethermind.public.dappnode.eth", title: "Nethermind" },
  ],
  prater: [
    { packageName: "goerli-geth.avado.dnp.dappnode.eth", title: "Geth" },
    { packageName: "nethermind-goerli.avado.dnp.dappnode.eth", title: "Nethermind" },
  ],
  holesky: [{ packageName: "holesky-geth.avado.dnp.dappnode.eth", title: "Geth" }],
  gnosis: [{ packageName: "nethermind-gnosis.avado.dnp.dappnode.eth", title: "Nethermind" }],
};

/** Candidates for a network; empty when the network has no known list. */
export function executionCandidates(network: Network): ExecutionCandidate[] {
  return EXECUTION_CANDIDATES[network] ?? [];
}

/**
 * A friendly name for an execution-client package: the known title, else a
 * guess from the package name (`besu.public.dappnode.eth` → "Besu").
 */
export function executionClientTitle(packageName: string): string {
  for (const list of Object.values(EXECUTION_CANDIDATES)) {
    const hit = list?.find((c) => c.packageName === packageName);
    if (hit) return hit.title;
  }
  const first = packageName.split(".")[0] ?? packageName;
  const known = ["geth", "nethermind", "besu", "erigon", "reth"].find((n) => first.includes(n));
  const base = known ?? first;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** "Geth", "Geth or Nethermind", "Geth, Besu or Nethermind". */
export function orList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}
