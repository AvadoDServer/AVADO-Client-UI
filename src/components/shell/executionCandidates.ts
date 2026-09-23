import type { Network } from "../../config/clientConfig";

/**
 * Execution-client packages per network, as in
 * AVADO-DNP-Nimbus/build/startNimbus.sh:19-35 (EE_CANDIDATES).
 *
 * TEMPORARY: Task 5 owns `src/config/executionClients.ts` with the full
 * candidate list (package + endpoint). At merge, derive this from that file
 * and delete this one. Only the package names are needed here.
 */
export const EXECUTION_CANDIDATES: Partial<Record<Network, string[]>> = {
  mainnet: ["ethchain-geth.public.dappnode.eth", "avado-dnp-nethermind.public.dappnode.eth"],
  prater: ["goerli-geth.avado.dnp.dappnode.eth", "nethermind-goerli.avado.dnp.dappnode.eth"],
  holesky: ["holesky-geth.avado.dnp.dappnode.eth"],
  gnosis: ["nethermind-gnosis.avado.dnp.dappnode.eth"],
};

/** Candidate packages for a network; empty when the network has no known list. */
export function executionCandidates(network: Network): string[] {
  return EXECUTION_CANDIDATES[network] ?? [];
}
