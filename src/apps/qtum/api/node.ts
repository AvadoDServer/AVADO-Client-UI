/**
 * Reads and actions on the Qtum node's JSON-RPC, as the pages use them. The
 * same calls the old wizard made; wallet calls go to the default wallet.
 */
import { isQtumApiError } from "./errors";
import {
  ADDRESS_TYPE,
  STAKING_UNLOCK_SECONDS,
  type AddressesByLabel,
  type Balances,
  type BlockchainInfo,
  type NetworkInfo,
  type StakingInfo,
  type WalletAddress,
  type WalletInfo,
} from "./models";
import type { QtumApi } from "./types";

/** What the status strip shows about the node. */
export interface NodeInfo {
  blocks: number;
  headers: number;
  /** 0..1 */
  progress: number;
  syncing: boolean;
  peers: number | undefined;
  /** "30.2.0" */
  version: string | undefined;
}

/** "/Qtum:30.2.0/" → "30.2.0". */
export function qtumVersion(subversion: string | undefined): string | undefined {
  const m = /Qtum:([0-9][0-9A-Za-z.\-+]*)/.exec(subversion ?? "");
  return m ? m[1] : undefined;
}

/** Syncing: the node is still downloading blocks (behind its headers, or in its first download). */
export function isSyncing(info: Pick<BlockchainInfo, "blocks" | "headers" | "initialblockdownload">): boolean {
  return info.initialblockdownload === true || info.blocks < info.headers;
}

export async function readNodeInfo(api: QtumApi): Promise<NodeInfo> {
  const chain = await api.rpc<BlockchainInfo>("getblockchaininfo");
  let net: NetworkInfo | undefined;
  try {
    net = await api.rpc<NetworkInfo>("getnetworkinfo");
  } catch {
    net = undefined;
  }
  return {
    blocks: chain.blocks,
    headers: chain.headers,
    progress: chain.verificationprogress,
    syncing: isSyncing(chain),
    peers: net?.connections,
    version: qtumVersion(net?.subversion),
  };
}

/** Sync progress as a percentage, rounded down to two decimals; never 100 while syncing. */
export function syncPercent(info: Pick<NodeInfo, "blocks" | "headers" | "progress" | "syncing">): string {
  const byBlocks = info.headers > 0 ? info.blocks / info.headers : 0;
  const p = Math.max(0, Math.min(1, Number.isFinite(info.progress) && info.progress > 0 ? info.progress : byBlocks));
  let pct = Math.floor(p * 10000) / 100;
  if (info.syncing && pct >= 100) pct = 99.99;
  return pct.toFixed(2);
}

/** The wallet as Home shows it. */
export interface WalletSummary {
  /** Spendable now. */
  available: number;
  /** Received, not confirmed yet. */
  pending: number;
  /** Coins in a recent stake (coins and reward come back after 500 blocks). */
  inStake: number;
  /** Other coins not spendable yet. */
  immature: number;
  total: number;
  /** The wallet has a password. */
  encrypted: boolean;
  /** With a password: unlocked (for staking) right now. */
  unlocked: boolean;
}

const coins = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
const round8 = (n: number) => Math.round(n * 1e8) / 1e8;

export function walletSummary(balances: Balances, info: WalletInfo): WalletSummary {
  const m = balances.mine;
  const available = coins(m.trusted);
  const pending = coins(m.untrusted_pending);
  const inStake = coins(m.stake);
  const immature = coins(m.immature);
  const encrypted = typeof info.unlocked_until === "number";
  return {
    available,
    pending,
    inStake,
    immature,
    total: round8(available + pending + inStake + immature),
    encrypted,
    unlocked: encrypted && (info.unlocked_until ?? 0) > 0,
  };
}

export async function readWallet(api: QtumApi): Promise<WalletSummary> {
  const [balances, info] = await Promise.all([api.rpc<Balances>("getbalances"), api.rpc<WalletInfo>("getwalletinfo")]);
  return walletSummary(balances, info);
}

export const readStakingInfo = (api: QtumApi) => api.rpc<StakingInfo>("getstakinginfo");

/** Every address in the wallet with its label, labels in the node's order. */
export async function listAddresses(api: QtumApi): Promise<WalletAddress[]> {
  const labels = await api.rpc<string[]>("listlabels");
  const out: WalletAddress[] = [];
  for (const label of labels) {
    let byLabel: AddressesByLabel;
    try {
      byLabel = await api.rpc<AddressesByLabel>("getaddressesbylabel", [label]);
    } catch (e) {
      // A label without receiving addresses answers "No addresses with label".
      if (isQtumApiError(e) && e.kind === "rpc") continue;
      throw e;
    }
    for (const [address, v] of Object.entries(byLabel)) {
      if (!v?.purpose || v.purpose === "receive") out.push({ address, label });
    }
  }
  return out;
}

/** A new receiving address (a plain one, which can stake). */
export const newAddress = (api: QtumApi, label = "") => api.rpc<string>("getnewaddress", [label.trim(), ADDRESS_TYPE]);

/**
 * The wallet's addresses; when it has none yet, one is made first, as the old
 * wizard did (a new wallet then always shows an address to send coins to).
 */
export async function addressesMakingOne(api: QtumApi): Promise<WalletAddress[]> {
  const list = await listAddresses(api);
  if (list.length > 0) return list;
  const address = await newAddress(api, "");
  return [{ address, label: "" }];
}

/** Unlock a wallet with a password for staking only (not for sending), until the node restarts. */
export const unlockForStaking = (api: QtumApi, password: string) =>
  api.rpc<null>("walletpassphrase", [password, STAKING_UNLOCK_SECONDS, true]);

export const lockWallet = (api: QtumApi) => api.rpc<null>("walletlock");
