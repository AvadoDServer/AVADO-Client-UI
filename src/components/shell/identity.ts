import type { ClientName, Network } from "../../config/clientConfig";
import lighthouseGnosis from "../../assets/clients/lighthouse-gnosis.png";
import lighthouseHolesky from "../../assets/clients/lighthouse-holesky.png";
import lighthouseMainnet from "../../assets/clients/lighthouse-mainnet.png";
import lighthousePrater from "../../assets/clients/lighthouse-prater.png";
import nimbusHolesky from "../../assets/clients/nimbus-holesky.png";
import nimbusMainnet from "../../assets/clients/nimbus-mainnet.png";
import nimbusPrater from "../../assets/clients/nimbus-prater.png";
import prysm from "../../assets/clients/PrysmStripe.png";
import tekuGnosis from "../../assets/clients/teku-gnosis.png";
import tekuHolesky from "../../assets/clients/teku-holesky.png";
import tekuMainnet from "../../assets/clients/teku-mainnet.png";
import tekuPrater from "../../assets/clients/teku-prater.png";

export const CLIENT_TITLE: Record<ClientName, string> = {
  nimbus: "Nimbus",
  teku: "Teku",
  prysm: "Prysm",
  lighthouse: "Lighthouse",
};

export const NETWORK_TITLE: Record<Network, string> = {
  mainnet: "Mainnet",
  holesky: "Holesky",
  prater: "Prater",
  gnosis: "Gnosis",
  hoodi: "Hoodi",
};

/** Test networks: their validators don't earn real ETH. */
export const TEST_NETWORKS: readonly Network[] = ["holesky", "prater", "hoodi"];

// The logos the client packages ship today (AVADO-DNP-Nimbus wizard assets).
const LOGOS: Record<ClientName, Partial<Record<Network, string>> & { mainnet: string }> = {
  nimbus: { mainnet: nimbusMainnet, holesky: nimbusHolesky, prater: nimbusPrater },
  lighthouse: { mainnet: lighthouseMainnet, holesky: lighthouseHolesky, prater: lighthousePrater, gnosis: lighthouseGnosis },
  teku: { mainnet: tekuMainnet, holesky: tekuHolesky, prater: tekuPrater, gnosis: tekuGnosis },
  prysm: { mainnet: prysm },
};

/** The client's logo for this network, or its mainnet logo when there is no network-specific one. */
export function clientLogo(client: ClientName, network: Network): string {
  const set = LOGOS[client];
  return set[network] ?? set.mainnet;
}

/**
 * Teku's logo is black line art on a transparent background, invisible on
 * the dark theme. Instead of recolouring it, it sits on a light plate.
 */
export const LOGO_NEEDS_PLATE: Record<ClientName, boolean> = {
  nimbus: false,
  lighthouse: false,
  teku: true,
  prysm: false,
};
