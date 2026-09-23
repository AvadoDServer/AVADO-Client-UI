/**
 * Adapter interfaces the pages build on. Real implementations talk to the
 * package backend on :9999 (deno or monitor), the beacon REST API through
 * `/rest`, the keymanager API through `/keymanager` and DAPPMANAGER over
 * WAMP (spec §3). `mock.ts` implements the same interfaces in memory.
 */

// ---------------------------------------------------------------------------
// Package backend (settings + supervisord)
// ---------------------------------------------------------------------------

/**
 * `/data/settings.json` for Nimbus (nimbus.md §2.2). Every field is optional
 * because old files may lack some; the index signature keeps fields this UI
 * does not know, which must survive a save (spec §2.5).
 */
export interface Settings {
  network?: string;
  /** Engine API URL, e.g. http://ethchain-geth.my.ava.do:8551 */
  ee_endpoint?: string;
  /** Package name of the execution client, e.g. ethchain-geth.public.dappnode.eth */
  execution_engine?: string;
  /** Max 32 bytes. */
  validators_graffiti?: string;
  /** Read by startNimbus.sh but not used by Nimbus. */
  p2p_peer_lower_bound?: number;
  /** --hard-max-peers */
  p2p_peer_upper_bound?: number;
  /** `^0x[a-fA-F0-9]{40}$`, or "" when not set yet. */
  validators_proposer_default_fee_recipient?: string;
  /** Checkpoint-sync URL, used once for the initial sync only. */
  initial_state?: string;
  mev_boost?: boolean;
  [key: string]: unknown;
}

/** supervisord `getAllProcessInfo` entry, as `/service/status` returns it. */
export interface ProcessInfo {
  name: string;
  group?: string;
  /** "RUNNING", "STOPPED", "STARTING", "BACKOFF", "EXITED", "FATAL", ... */
  statename: string;
  state?: number;
  description?: string;
  pid?: number;
  /** Unix seconds. */
  start?: number;
  stop?: number;
  now?: number;
  exitstatus?: number;
  spawnerr?: string;
  [key: string]: unknown;
}

export type ServiceAction = "start" | "stop" | "restart";

export interface PackageBackend {
  getSettings(): Promise<Settings>;
  /** Full-object write: the backend overwrites settings.json and restarts the client. */
  saveSettings(s: Settings): Promise<void>;
  getDefaultSettings(): Promise<Settings>;
  service(action: ServiceAction): Promise<void>;
  serviceStatus(): Promise<ProcessInfo[]>;
}

// ---------------------------------------------------------------------------
// Beacon node REST API (standard eth/v1, through `${apiUrl}/rest`)
// ---------------------------------------------------------------------------

export type NodeHealth = "ready" | "syncing" | "not_ready";

/** GET /eth/v1/node/syncing → data. Numbers arrive as decimal strings. */
export interface SyncingStatus {
  head_slot: string;
  sync_distance: string;
  is_syncing: boolean;
  is_optimistic?: boolean;
  el_offline?: boolean;
}

/** GET /eth/v1/node/peer_count → data. */
export interface PeerCount {
  connected: string;
  disconnected: string;
  connecting: string;
  disconnecting: string;
}

/** GET /eth/v1/node/peers → data[]. */
export interface Peer {
  peer_id: string;
  enr?: string | null;
  last_seen_p2p_address?: string;
  state: "connected" | "connecting" | "disconnected" | "disconnecting";
  direction: "inbound" | "outbound";
}

/** Standard beacon validator statuses. */
export type ValidatorStatus =
  | "pending_initialized"
  | "pending_queued"
  | "active_ongoing"
  | "active_exiting"
  | "active_slashed"
  | "exited_unslashed"
  | "exited_slashed"
  | "withdrawal_possible"
  | "withdrawal_done";

/** GET /eth/v1/beacon/states/head/validators/{pubkey} → data. Gwei and epochs as decimal strings. */
export interface ValidatorState {
  index: string;
  balance: string;
  status: ValidatorStatus;
  validator: {
    pubkey: string;
    /** 0x00… BLS (needs an update), 0x01… execution address, 0x02… compounding. */
    withdrawal_credentials: string;
    effective_balance: string;
    slashed: boolean;
    activation_eligibility_epoch: string;
    activation_epoch: string;
    exit_epoch: string;
    withdrawable_epoch: string;
  };
}

export interface VoluntaryExit {
  epoch: string;
  validator_index: string;
}

export interface SignedVoluntaryExit {
  message: VoluntaryExit;
  signature: string;
}

export interface BeaconApi {
  health(): Promise<NodeHealth>;
  syncing(): Promise<SyncingStatus>;
  peerCount(): Promise<PeerCount>;
  peers(): Promise<Peer[]>;
  /** Short client version, e.g. "v26.8.0". */
  version(): Promise<string>;
  /** `null` when the beacon node doesn't know the key yet (HTTP 404: waiting for deposit). */
  validator(pubkey: string): Promise<ValidatorState | null>;
  /** POST /eth/v1/beacon/pool/voluntary_exits */
  submitVoluntaryExit(msg: SignedVoluntaryExit): Promise<void>;
}

// ---------------------------------------------------------------------------
// Keymanager API (through `${apiUrl}/keymanager`, token added server-side)
// ---------------------------------------------------------------------------

export interface Keystore {
  validating_pubkey: string;
  derivation_path?: string;
  readonly?: boolean;
}

export interface ImportKeystoresRequest {
  /** Keystore JSON files, each as a string. */
  keystores: string[];
  /** One password per keystore, same order. */
  passwords: string[];
  /** EIP-3076 interchange JSON as a string. */
  slashing_protection?: string;
}

export type ImportStatus = "imported" | "duplicate" | "error";
export interface ImportResult {
  status: ImportStatus;
  message?: string;
}

export type DeleteStatus = "deleted" | "not_active" | "not_found" | "error";
export interface DeleteKeystoresResponse {
  data: Array<{ status: DeleteStatus; message?: string }>;
  /** EIP-3076 interchange JSON as a string — offer it as a download. */
  slashing_protection: string;
}

export interface KeymanagerApi {
  listKeystores(): Promise<Keystore[]>;
  /** One result per keystore, same order. */
  importKeystores(req: ImportKeystoresRequest): Promise<ImportResult[]>;
  deleteKeystores(pubkeys: string[]): Promise<DeleteKeystoresResponse>;
  /**
   * The fee recipient the keymanager reports for this key: the override, or
   * (Nimbus) the default when there is none. `null` when the keymanager has
   * none (HTTP 404). Compare with the settings default to tell them apart.
   */
  getFeeRecipient(pubkey: string): Promise<string | null>;
  setFeeRecipient(pubkey: string, ethaddress: string): Promise<void>;
  /** Clears the override, so the key falls back to the default fee recipient. */
  deleteFeeRecipient(pubkey: string): Promise<void>;
  signVoluntaryExit(pubkey: string, epoch?: string): Promise<SignedVoluntaryExit>;
}

// ---------------------------------------------------------------------------
// DAPPMANAGER over WAMP
// ---------------------------------------------------------------------------

export interface DappManager {
  /** Names of the installed packages (e.g. "mevboost.avado.dnp.dappnode.eth"). */
  listPackages(): Promise<string[]>;
  /** The last `tail` log lines of a package, ANSI colours included. */
  logs(pkg: string, tail: number): Promise<string>;
}

// ---------------------------------------------------------------------------

export interface Api {
  backend: PackageBackend;
  beacon: BeaconApi;
  keymanager: KeymanagerApi;
  dappmanager: DappManager;
}
