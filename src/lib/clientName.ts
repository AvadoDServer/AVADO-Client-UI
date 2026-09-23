import type { ClientName } from "../config/clientConfig";

/** Display name of each consensus client. */
export const CLIENT_DISPLAY_NAME: Record<ClientName, string> = {
  nimbus: "Nimbus",
  teku: "Teku",
  prysm: "Prysm",
  lighthouse: "Lighthouse",
};

export function clientDisplayName(client: ClientName): string {
  return CLIENT_DISPLAY_NAME[client] ?? client;
}
