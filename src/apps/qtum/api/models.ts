/**
 * What the Qtum package's backend answers: the monitor (`/monitor/*`) and the
 * Qtum node's JSON-RPC (`/rpc`). Field names are the backend's own.
 */

/** The wallet task the monitor reports (`GET /monitor/walletstatus` → `state`). */
export type WalletState =
  | "starting"
  | "restarting"
  | "migrating"
  | "rebuilding"
  | "restoring"
  | "ready"
  | "needs-passphrase"
  | "failed"
  | "stopped";

export interface MigrationInfo {
  /** pending | done | failed | needs-passphrase | … */
  state: string;
  /** "upgrade" (migratewallet) or "rebuild" (rebuilt from the old copy). */
  method: string;
  migratedAt: string | null;
  failedAt: string | null;
  error: string | null;
  /** The wallet has a password. */
  encrypted: boolean;
  /** A rebuild from the old copy is possible now. */
  canRebuild: boolean;
}

export interface RebuildInfo {
  /** running | done | failed | interrupted | needs-passphrase | superseded */
  state: string;
  step: string | null;
  progress: number | null;
  error: string | null;
  /** One sentence: what the rebuilt wallet does not have ("" if nothing). */
  notCarriedOver: string;
  /** "raw-pages": the old wallet file was damaged and read directly. */
  source: string | null;
  /** All addresses from the old wallet's seed were restored. */
  seedRestored: boolean;
}

export interface ImportInfo {
  state: "running" | "done" | "failed";
  message?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface RestoreResult {
  state: "failed";
  message: string;
  at: string;
}

export interface WalletStatus {
  state: WalletState | string;
  /** The monitor's own words (technical; shown under Details only). */
  message: string;
  /** "wallet-missing" or null. */
  problem: string | null;
  /** The wallet task that is running, if any. */
  busy: string | null;
  migration: MigrationInfo | null;
  rebuild: RebuildInfo | null;
  /** The wallet was upgraded or rebuilt: a fresh backup is needed. */
  newBackupRequired: boolean;
  import: ImportInfo | null;
  restore: RestoreResult | null;
  /** The wallet is scanning the blockchain (during a key import). */
  scanning: false | { duration?: number; progress?: number };
}

/** `GET /monitor/getenv`. */
export interface QtumSettings {
  /** Fee kept from delegators' rewards, whole percent 0–100. */
  DELEGATION_FEE_PERCENT: number;
  /** Smallest delegation accepted, in QTUM. */
  MIN_DELEGATION_AMOUNT: number;
  /** No backup downloaded yet since the wallet was made. */
  BACKUP_REQUIRED: boolean;
}

export type SettingsPatch = Partial<Pick<QtumSettings, "DELEGATION_FEE_PERCENT" | "MIN_DELEGATION_AMOUNT">>;

/** `GET /monitor/staking-summary`. Amounts in QTUM. */
export interface StakingSummary {
  totalRewards: number;
  rewards30d: number;
  /** Rewards in the last 30 days. */
  count: number;
  /** Rewards in total. */
  countAll: number;
  lastRewardAt: string | null;
  computedAt: string;
  /** The wallet has more transactions than the monitor read. */
  truncated?: boolean;
}

export interface BackupDownload {
  blob: Blob;
  fileName: string;
}

// ---------------------------------------------------------------------------
// JSON-RPC answers (only the fields the app reads)
// ---------------------------------------------------------------------------

export interface BlockchainInfo {
  chain: string;
  blocks: number;
  headers: number;
  verificationprogress: number;
  initialblockdownload: boolean;
}

export interface NetworkInfo {
  version: number;
  /** "/Qtum:30.2.0/" */
  subversion: string;
  connections: number;
}

export interface Balances {
  mine: {
    trusted: number;
    untrusted_pending: number;
    /** Immature coinbase outputs. */
    immature: number;
    /** Immature coinstake outputs: coins in a recent stake. */
    stake?: number;
  };
}

export interface WalletInfo {
  walletname: string;
  /** Only for a wallet with a password: until when it is unlocked (0 = locked). */
  unlocked_until?: number;
  scanning?: false | { duration: number; progress: number };
}

export interface StakingInfo {
  enabled: boolean;
  staking: boolean;
  errors: string;
  weight: number;
  netstakeweight: number;
  /** Expected seconds to the next reward (0 = no estimate). */
  expectedtime: number;
}

/** `getaddressesbylabel` → address → { purpose }. */
export type AddressesByLabel = Record<string, { purpose?: string }>;

export interface WalletAddress {
  address: string;
  label: string;
}

/** The address type every address the app makes has: staking needs a plain (legacy) address. */
export const ADDRESS_TYPE = "legacy";
/** walletpassphrase: unlock for staking only, for as long as the node allows (~3 years, until a restart). */
export const STAKING_UNLOCK_SECONDS = 99_999_999;

// ---------------------------------------------------------------------------
// Parsing (the monitor's answer, defensively)
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The wallet status answer, or null when it isn't one. */
export function parseWalletStatus(raw: unknown): WalletStatus | null {
  if (!isObject(raw) || typeof raw.state !== "string") return null;
  const m = isObject(raw.migration) ? raw.migration : null;
  const r = isObject(raw.rebuild) ? raw.rebuild : null;
  const imp = isObject(raw.import) && typeof raw.import.state === "string" ? (raw.import as unknown as ImportInfo) : null;
  const restore = isObject(raw.restore) && raw.restore.state === "failed" ? (raw.restore as unknown as RestoreResult) : null;
  return {
    state: raw.state,
    message: str(raw.message) ?? "",
    problem: str(raw.problem),
    busy: str(raw.busy),
    migration: m
      ? {
          state: str(m.state) ?? "",
          method: str(m.method) ?? "upgrade",
          migratedAt: str(m.migratedAt),
          failedAt: str(m.failedAt),
          error: str(m.error),
          encrypted: m.encrypted === true,
          canRebuild: m.canRebuild !== false,
        }
      : null,
    rebuild: r
      ? {
          state: str(r.state) ?? "",
          step: str(r.step),
          progress: typeof r.progress === "number" ? r.progress : null,
          error: str(r.error),
          notCarriedOver: str(r.notCarriedOver) ?? "",
          source: str(r.source),
          seedRestored: r.seedRestored === true,
        }
      : null,
    newBackupRequired: raw.newBackupRequired === true,
    import: imp,
    restore,
    scanning: isObject(raw.scanning) ? (raw.scanning as { duration?: number; progress?: number }) : false,
  };
}

/** The settings answer, with the package defaults for anything missing. */
export function parseSettings(raw: unknown): QtumSettings | null {
  if (!isObject(raw)) return null;
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  return {
    DELEGATION_FEE_PERCENT: num(raw.DELEGATION_FEE_PERCENT, 10),
    MIN_DELEGATION_AMOUNT: num(raw.MIN_DELEGATION_AMOUNT, 100),
    BACKUP_REQUIRED: raw.BACKUP_REQUIRED === true,
  };
}

/** Wallet states during which the monitor is busy with the wallet (poll often). */
export const BUSY_STATES: readonly string[] = ["starting", "restarting", "migrating", "rebuilding", "restoring"];
