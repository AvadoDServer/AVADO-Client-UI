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

/**
 * Host/package prefix for a client on a network: `nimbus` on mainnet and
 * `nimbus-holesky` elsewhere. Prysm's beacon chain always carries the
 * network, mainnet included: `prysm-beacon-chain-mainnet`.
 */
export function packagePrefix(client: ClientName, network: Network): string {
  if (client === "prysm") return `prysm-beacon-chain-${network}`;
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

/** Hostname label each client's packages start with. */
const HOST_BASE: Record<ClientName, string> = {
  nimbus: "nimbus",
  teku: "teku",
  prysm: "prysm-beacon-chain",
  lighthouse: "lighthouse",
};

/** Best guess from a hostname like `teku-holesky.my.ava.do` or `prysm-beacon-chain-mainnet.my.ava.do`. */
export function guessFromHostname(hostname: string): { client?: ClientName; network?: Network } {
  const first = hostname.toLowerCase().split(".")[0] ?? "";
  for (const client of CLIENTS) {
    const base = HOST_BASE[client];
    if (first !== base && !first.startsWith(`${base}-`)) continue;
    const n = first.slice(base.length + 1);
    if (!n) return client === "prysm" ? { client } : { client, network: "mainnet" };
    return isOneOf(NETWORKS, n) ? { client, network: n } : { client };
  }
  return {};
}

export type ClientConfigSource = "file" | "hostname" | "default";

/**
 * The loaded config plus where it came from and what was wrong with it.
 * `problems` is empty when client-config.json was read and every field it
 * has is valid. The shell shows a "wrong configuration" banner otherwise.
 */
export interface ClientConfigResult {
  config: ClientConfig;
  source: ClientConfigSource;
  problems: string[];
}

type Fallback = { client?: ClientName; network?: Network };

/** Fill every missing or invalid field and list what was invalid or missing. */
export function checkClientConfig(raw: unknown, fallback: Fallback = {}): { config: ClientConfig; problems: string[] } {
  const problems: string[] = [];
  const isObject = !!raw && typeof raw === "object" && !Array.isArray(raw);
  if (!isObject) problems.push("client-config.json is not a JSON object");
  const r = (isObject ? raw : {}) as Record<string, unknown>;
  const show = (v: unknown) => JSON.stringify(v);

  let client: ClientName;
  if (isOneOf(CLIENTS, r.client)) client = r.client;
  else {
    client = fallback.client ?? DEFAULT_CLIENT;
    if (isObject)
      problems.push(r.client === undefined ? `No client set; using ${client}` : `Unknown client ${show(r.client)}; using ${client}`);
  }

  let network: Network;
  if (isOneOf(NETWORKS, r.network)) network = r.network;
  else {
    network = fallback.network ?? DEFAULT_NETWORK;
    if (isObject)
      problems.push(r.network === undefined ? `No network set; using ${network}` : `Unknown network ${show(r.network)}; using ${network}`);
  }

  const packageName = nonEmptyString(r.packageName) ? r.packageName : defaultPackageName(client, network);
  if (r.packageName !== undefined && !nonEmptyString(r.packageName))
    problems.push(`Invalid packageName ${show(r.packageName)}; using ${packageName}`);

  const apiUrl = nonEmptyString(r.apiUrl) ? r.apiUrl.replace(/\/+$/, "") : defaultApiUrl(client, network);
  if (r.apiUrl !== undefined && !nonEmptyString(r.apiUrl)) problems.push(`Invalid apiUrl ${show(r.apiUrl)}; using ${apiUrl}`);

  const backend = isOneOf(BACKENDS, r.backend) ? r.backend : DEFAULT_BACKEND[client];
  if (r.backend !== undefined && !isOneOf(BACKENDS, r.backend)) problems.push(`Unknown backend ${show(r.backend)}; using ${backend}`);

  const featuresOk = r.features === undefined || (!!r.features && typeof r.features === "object" && !Array.isArray(r.features));
  if (!featuresOk) problems.push(`Invalid features ${show(r.features)}; using the defaults`);
  const f = (featuresOk && r.features ? r.features : {}) as Record<string, unknown>;
  const flag = (k: keyof ClientFeatures) => {
    if (typeof f[k] === "boolean") return f[k] as boolean;
    if (f[k] !== undefined) problems.push(`Invalid features.${k} ${show(f[k])}; using ${DEFAULT_FEATURES[k]}`);
    return DEFAULT_FEATURES[k];
  };
  const features = { batchImport: flag("batchImport"), backup: flag("backup"), zeroSync: flag("zeroSync") };

  return { config: { client, network, packageName, apiUrl, backend, features }, problems };
}

/** Fill every missing or invalid field of a raw config object. */
export function normalizeClientConfig(raw: unknown, fallback: Fallback = {}): ClientConfig {
  return checkClientConfig(raw, fallback).config;
}

/** Absolute, like the asset URLs (vite `base: "/"`), so a deep link such as `/settings/` still finds it. */
export const CLIENT_CONFIG_URL = "/client-config.json";

/**
 * Load `/client-config.json` and report where the config came from. Never
 * rejects: a missing, unreadable or malformed file yields the hostname's
 * guess (source "hostname") or Nimbus on mainnet (source "default"), with
 * the reason in `problems`.
 */
export async function loadClientConfigResult(): Promise<ClientConfigResult> {
  const fallback = typeof window !== "undefined" ? guessFromHostname(window.location.hostname) : {};
  let raw: unknown;
  try {
    const res = await fetch(CLIENT_CONFIG_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (e) {
    const reason = e instanceof SyntaxError ? "it is not valid JSON" : String(e instanceof Error ? e.message : e);
    const { config } = checkClientConfig({}, fallback);
    const source: ClientConfigSource = fallback.client ? "hostname" : "default";
    const using = source === "hostname" ? "guessed from the page address" : "the defaults";
    const problem = `client-config.json could not be loaded (${reason}); using ${using}: ${config.client} on ${config.network}`;
    console.warn(problem);
    return { config, source, problems: [problem] };
  }
  const { config, problems } = checkClientConfig(raw, fallback);
  if (problems.length) console.warn(`client-config.json: ${problems.join("; ")}`);
  return { config, source: "file", problems };
}

/** Load `/client-config.json`; see `loadClientConfigResult()` for provenance. */
export async function loadClientConfig(): Promise<ClientConfig> {
  return (await loadClientConfigResult()).config;
}

// Convenience re-exports so callers can import everything config-related
// from this module.
export { ClientConfigProvider, useClientConfig, useClientConfigStatus } from "./ClientConfigProvider";
