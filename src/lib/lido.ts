/**
 * Lido Community Staking Module (CSM): the addresses a CSM validator must use
 * and the checks the Lido CSM page runs. Pure functions only.
 *
 * Every address below was read on 2026-11-04 from docs.lido.fi
 * (deployed-contracts) and checked on-chain against the Lido Locator
 * (`elRewardsVault()`, `withdrawalVault()`). The relay lists are the
 * on-chain MEV-Boost Relay Allowed List (`get_relays()`) on the same day.
 */
import type { Network } from "../config/clientConfig";
import { sameAddress } from "../pages/validators/statusText";

export interface LidoRelay {
  /** Relay operator and name, as Lido lists it. */
  name: string;
  /** Lower-case host, e.g. "boost-relay.flashbots.net". */
  host: string;
  /** Lower-case 0x BLS pubkey of the relay. */
  pubkey: string;
  /** Lido's "must use some" relays: at least one of them must be used. */
  mustUse: boolean;
}

export interface LidoNetwork {
  /** Where the 32 ETH goes on exit: the withdrawal address of every Lido key. */
  withdrawalVault: string;
  /** Where block rewards (tips and MEV) must go: the fee recipient of every Lido key. */
  elRewardsVault: string;
  /** Lido's own CSM app. */
  csmUrl: string;
  /** Lido's key generation guide for this network. */
  keyGuideUrl: string;
  /** deposit_data `fork_version` / `network_name` of this network. */
  forkVersion: string;
  networkName: string;
  /** Lido's relay list (null: AVADO has no MEV-Boost package on this network). */
  relays: LidoRelay[] | null;
  /** The on-chain relay list contract, for the "see Lido's list" link. */
  relayListContract: string;
  explorer: string;
  /** CSM Sentinel, Lido's Telegram bot for exit requests. */
  sentinelUrl: string;
}

/** The day the relay lists below were read from the chain. */
export const LIDO_RELAYS_CHECKED = "2026-11-04";

const relay = (name: string, url: string, mustUse: boolean): LidoRelay => {
  const [pubkey, host] = url.replace(/^https:\/\//, "").split("@");
  return { name, host: host.toLowerCase(), pubkey: pubkey.toLowerCase(), mustUse };
};

export const LIDO_NETWORKS: Partial<Record<Network, LidoNetwork>> = {
  mainnet: {
    withdrawalVault: "0xB9D7934878B5FB9610B3fE8A5e441e8fad7E293f",
    elRewardsVault: "0x388C818CA8B9251b393131C08a736A67ccB19297",
    csmUrl: "https://csm.lido.fi",
    keyGuideUrl: "https://docs.lido.fi/run-on-lido/csm/generating-validator-keys/key-generation-for-mainnet/",
    forkVersion: "00000000",
    networkName: "mainnet",
    relayListContract: "0xF95f069F9AD107938F6ba802a3da87892298610E",
    explorer: "https://etherscan.io",
    sentinelUrl: "https://t.me/CSMSentinel_bot",
    relays: [
      relay("Agnostic Relay", "https://0xa7ab7a996c8584251c8f925da3170bdfd6ebc75d50f5ddc4050a6fdc77f2a3b5fce2cc750d0865e05d7228af97d69561@agnostic-relay.net", true),
      relay("bloXroute Regulated", "https://0xb0b07cd0abef743db4260b0ed50619cf6ad4d82064cb4fbec9d3ec530f7c5e6793d9f286c4e082c0244ffb9f2658fe88@bloxroute.regulated.blxrbdn.com", true),
      relay("Aestus", "https://0xa15b52576bcbf1072f4a011c0f99f9fb6c66f3e1ff321f11f461d15e31b1cb359caa092c71bbded0bae5b5ea401aab7e@aestus.live", true),
      relay("Ultra Sound (filtering)", "https://0xa1559ace749633b997cb3fdacffb890aeebdb0f5a3b6aaa7eeeaf1a38af0a8fe88b9e4b1f61f236d2e64d95733327a62@relay-filtered.ultrasound.money", true),
      relay("Flashbots", "https://0xac6e77dfe25ecd6110b8e780608cce0dab71fdd5ebea22a16c0205200f2f8e2e3ad3b71d3499c54ad14d6c21b41a37ae@boost-relay.flashbots.net", true),
      relay("Ultra Sound", "https://0xa1559ace749633b997cb3fdacffb890aeebdb0f5a3b6aaa7eeeaf1a38af0a8fe88b9e4b1f61f236d2e64d95733327a62@relay.ultrasound.money", true),
      relay("Titan Regional", "https://0x8c4ed5e24fe5c6ae21018437bde147693f68cda427cd1122cf20819c30eda7ed74f72dece09bb313f2a1855595ab677d@regional.titanrelay.xyz", false),
      relay("Titan Global", "https://0x8c4ed5e24fe5c6ae21018437bde147693f68cda427cd1122cf20819c30eda7ed74f72dece09bb313f2a1855595ab677d@global.titanrelay.xyz", false),
    ],
  },
  hoodi: {
    withdrawalVault: "0x4473dCDDbf77679A643BdB654dbd86D67F8d32f2",
    elRewardsVault: "0x9b108015fe433F173696Af3Aa0CF7CDb3E104258",
    csmUrl: "https://csm.testnet.fi",
    keyGuideUrl: "https://docs.lido.fi/run-on-lido/csm/generating-validator-keys/key-generation-for-testnet",
    forkVersion: "10000910",
    networkName: "hoodi",
    relayListContract: "0x279d3A456212a1294DaEd0faEE98675a52E8A4Bf",
    explorer: "https://hoodi.etherscan.io",
    sentinelUrl: "https://t.me/CSMSentinelHoodi_bot",
    // AVADO's MEV-Boost package runs on mainnet only.
    relays: null,
  },
};

/** Lido's documentation pages the CSM page links to. */
export const LIDO_DOCS = {
  csm: "https://docs.lido.fi/run-on-lido/csm/",
  bonds: "https://docs.lido.fi/run-on-lido/csm/lido-csm-widget/rewards-and-bonds",
  exits: "https://docs.lido.fi/run-on-lido/csm/lido-csm-widget/exiting-csm-validators/",
  penalties: "https://docs.lido.fi/run-on-lido/csm/penalties",
  contracts: "https://docs.lido.fi/deployed-contracts/",
} as const;

export const lidoNetwork = (network: Network): LidoNetwork | null => LIDO_NETWORKS[network] ?? null;

/** 0x01 or 0x02 credentials paying out to Lido's withdrawal vault. */
export function isLidoCredentials(credentials: string | null | undefined, network: Network): boolean {
  const lido = lidoNetwork(network);
  if (!lido || !credentials) return false;
  const m = /^0x0[12]0{22}([0-9a-f]{40})$/i.exec(credentials.trim());
  return !!m && sameAddress(`0x${m[1]}`, lido.withdrawalVault);
}

export const isLidoFeeRecipient = (address: string | null | undefined, network: Network): boolean =>
  sameAddress(address, lidoNetwork(network)?.elRewardsVault);

// ---------------------------------------------------------------------------
// deposit_data-….json
// ---------------------------------------------------------------------------

export type DepositDataResult =
  | { kind: "not-deposit-data" }
  /** A deposit data file for another network. */
  | { kind: "wrong-network"; fileNetwork: string }
  /** Deposit data, but none of its keys pays out to Lido. */
  | { kind: "not-lido"; count: number }
  /** `lido`: 0x-prefixed lower-case pubkeys whose withdrawals go to Lido. `other`: the rest of the file. */
  | { kind: "lido"; lido: string[]; other: string[] };

const hex0x = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const h = v.trim().replace(/^0x/i, "").toLowerCase();
  return /^[0-9a-f]+$/.test(h) ? `0x${h}` : null;
};

/**
 * Read a deposit data file (the one uploaded to Lido's CSM app). It holds
 * public keys, withdrawal credentials and deposit signatures only: no
 * secret. Which of its keys pay out to Lido on this network?
 */
export function readDepositData(text: string, network: Network): DepositDataResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: "not-deposit-data" };
  }
  if (!Array.isArray(json) || json.length === 0) return { kind: "not-deposit-data" };
  const entries = json.filter((d): d is Record<string, unknown> => !!d && typeof d === "object" && "deposit_data_root" in d);
  if (entries.length === 0) return { kind: "not-deposit-data" };

  const lido = lidoNetwork(network);
  for (const d of entries) {
    const name = typeof d.network_name === "string" ? d.network_name.toLowerCase() : null;
    const fork = typeof d.fork_version === "string" ? d.fork_version.replace(/^0x/i, "").toLowerCase() : null;
    const wrong = lido
      ? (name !== null && name !== lido.networkName) || (fork !== null && fork !== lido.forkVersion)
      : false;
    if (wrong) return { kind: "wrong-network", fileNetwork: name ?? `fork ${fork}` };
  }

  const lidoKeys: string[] = [];
  const other: string[] = [];
  for (const d of entries) {
    const pubkey = hex0x(d.pubkey);
    if (!pubkey || pubkey.length !== 98) continue;
    if (isLidoCredentials(hex0x(d.withdrawal_credentials), network)) lidoKeys.push(pubkey);
    else other.push(pubkey);
  }
  if (lidoKeys.length === 0) return { kind: "not-lido", count: entries.length };
  return { kind: "lido", lido: [...new Set(lidoKeys)], other: [...new Set(other)] };
}

// ---------------------------------------------------------------------------
// MEV-Boost relays
// ---------------------------------------------------------------------------

export interface BoxRelay {
  /** As configured on the box. */
  url: string;
  host: string;
  pubkey: string | null;
  /** The matching relay on Lido's list, if any. */
  lido?: LidoRelay;
}

export type RelayCheck =
  /** Every relay is on Lido's list and at least one is a "must use" relay. */
  | { kind: "ok"; relays: BoxRelay[] }
  /** Some relays are not on Lido's list. */
  | { kind: "not-allowed"; relays: BoxRelay[]; notAllowed: BoxRelay[] }
  /** All on the list, but none of Lido's "must use" relays. */
  | { kind: "no-must-use"; relays: BoxRelay[] }
  | { kind: "none" };

/** The same parsing as the Admin's MEV-Boost Relays card: scheme optional, comma separated. */
export function parseRelays(value: string | null | undefined): BoxRelay[] {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((url) => {
      const after = url.replace(/^https?:\/\//i, "");
      const at = after.lastIndexOf("@");
      const host = (at >= 0 ? after.slice(at + 1) : after).replace(/\/+$/, "").toLowerCase();
      const key = at >= 0 ? after.slice(0, at).toLowerCase() : "";
      return { url, host, pubkey: /^0x[0-9a-f]{96}$/.test(key) ? key : null };
    });
}

/** Line the box's RELAYS value up against Lido's list. */
export function checkRelays(value: string | null | undefined, list: LidoRelay[]): RelayCheck {
  const relays = parseRelays(value).map((r) => ({
    ...r,
    lido: list.find((l) => l.host === r.host && l.pubkey === r.pubkey),
  }));
  if (relays.length === 0) return { kind: "none" };
  const notAllowed = relays.filter((r) => !r.lido);
  if (notAllowed.length > 0) return { kind: "not-allowed", relays, notAllowed };
  if (!relays.some((r) => r.lido?.mustUse)) return { kind: "no-must-use", relays };
  return { kind: "ok", relays };
}

/** A readable name for a relay on the box: Lido's name, else its host. */
export const relayLabel = (r: BoxRelay): string => r.lido?.name ?? r.host;
