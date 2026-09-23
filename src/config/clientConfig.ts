/**
 * Runtime client configuration (spec §3).
 *
 * Each client package writes `client-config.json` next to `index.html` at
 * image build time, so one UI build serves every client and network. Any
 * missing or invalid field falls back to a default derived from `client` and
 * `network`; a missing file falls back to what the page's hostname implies
 * (`teku-holesky.my.ava.do` → teku on holesky), then to Nimbus on mainnet.
 */

export const CLIENTS = ["nimbus", "teku", "prysm", "lighthouse"] as const;
export const NETWORKS = ["mainnet", "holesky", "prater", "gnosis", "hoodi"] as const;
export const BACKENDS = ["deno", "monitor"] as const;

export type ClientName = (typeof CLIENTS)[number];
export type Network = (typeof NETWORKS)[number];
export type BackendKind = (typeof BACKENDS)[number];

export interface ClientFeatures {
  batchImport: boolean;
  backup: boolean;
  zeroSync: boolean;
}

export interface ClientConfig {
  client: ClientName;
  network: Network;
  packageName: string;
  apiUrl: string;
  backend: BackendKind;
  features: ClientFeatures;
}

export const DEFAULT_CLIENT: ClientName = "nimbus";
export const DEFAULT_NETWORK: Network = "mainnet";

/** Nimbus and Lighthouse ship the Deno backend; Teku and Prysm the monitor. */
const DEFAULT_BACKEND: Record<ClientName, BackendKind> = {
  nimbus: "deno",
  lighthouse: "deno",
  teku: "monitor",
  prysm: "monitor",
};

export const DEFAULT_FEATURES: ClientFeatures = {
  batchImport: true,
  backup: false,
  zeroSync: false,
};

/** `nimbus` on mainnet, `nimbus-holesky` elsewhere. */
export function packagePrefix(client: ClientName, network: Network): string {
  return network === "mainnet" ? client : `${client}-${network}`;
}

export function defaultPackageName(client: ClientName, network: Network): string {
  return `${packagePrefix(client, network)}.avado.dnp.dappnode.eth`;
}

export function defaultApiUrl(client: ClientName, network: Network): string {
  return `http://${packagePrefix(client, network)}.my.ava.do:9999`;
}

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

const nonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Best guess from a hostname like `teku-holesky.my.ava.do`. */
export function guessFromHostname(hostname: string): { client?: ClientName; network?: Network } {
  const first = hostname.toLowerCase().split(".")[0] ?? "";
  const [c, ...rest] = first.split("-");
  const n = rest.join("-");
  if (!isOneOf(CLIENTS, c)) return {};
  if (!n) return { client: c, network: "mainnet" };
  return isOneOf(NETWORKS, n) ? { client: c, network: n } : { client: c };
}

/** Fill every missing or invalid field of a raw config object. */
export function normalizeClientConfig(raw: unknown, fallback: { client?: ClientName; network?: Network } = {}): ClientConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const client = isOneOf(CLIENTS, r.client) ? r.client : (fallback.client ?? DEFAULT_CLIENT);
  const network = isOneOf(NETWORKS, r.network) ? r.network : (fallback.network ?? DEFAULT_NETWORK);
  const f = (r.features && typeof r.features === "object" ? r.features : {}) as Record<string, unknown>;
  const flag = (k: keyof ClientFeatures) => (typeof f[k] === "boolean" ? (f[k] as boolean) : DEFAULT_FEATURES[k]);

  return {
    client,
    network,
    packageName: nonEmptyString(r.packageName) ? r.packageName : defaultPackageName(client, network),
    apiUrl: nonEmptyString(r.apiUrl) ? r.apiUrl.replace(/\/+$/, "") : defaultApiUrl(client, network),
    backend: isOneOf(BACKENDS, r.backend) ? r.backend : DEFAULT_BACKEND[client],
    features: { batchImport: flag("batchImport"), backup: flag("backup"), zeroSync: flag("zeroSync") },
  };
}

export const CLIENT_CONFIG_URL = "./client-config.json";

/**
 * Load `./client-config.json`. Never rejects: a missing, unreadable or
 * malformed file yields defaults (from the hostname when it identifies a
 * client), so the UI always starts.
 */
export async function loadClientConfig(): Promise<ClientConfig> {
  const fallback = typeof window !== "undefined" ? guessFromHostname(window.location.hostname) : {};
  try {
    const res = await fetch(CLIENT_CONFIG_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return normalizeClientConfig(await res.json(), fallback);
  } catch (e) {
    console.warn(`client-config.json could not be loaded (${String(e)}); using defaults`);
    return normalizeClientConfig({}, fallback);
  }
}

// Convenience re-exports so callers can import everything config-related
// from this module.
export { ClientConfigProvider, useClientConfig } from "./ClientConfigProvider";
