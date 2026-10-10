/**
 * What the package backend returns, typed. Smartnode shapes follow
 * `shared/types/api/*.go` at v1.24.2 (research §3.3); only the fields the
 * app reads are listed. The AVADO shapes follow the backend
 * (`build/backend/src/avado/*`, task-2 report).
 *
 * Big integers (wei, RPL) are `BigNumberish`: a JSON number when it is a safe
 * integer, else a string with the exact digits (the backend's bigint-safe
 * parse). Format them with `lib/units`, never with Number().
 */
import type { BigNumberish } from "../lib/units";

export type { BigNumberish };

/* ------------------------------------------------------------------ */
/* Smartnode envelope and transactions                                 */
/* ------------------------------------------------------------------ */

/** Every Smartnode (and backend) answer. */
export interface SnEnvelope {
  status: "success" | "error";
  error: string;
}

/** `can-X` gas estimate (`bindings/transactions/gaslimit/gas.go`). */
export interface GasLimits {
  estimated: number;
  safe: number;
}

/** A `can-X` answer: eligibility flags plus the gas estimate. */
export interface CanResponse extends SnEnvelope {
  gasLimits?: GasLimits;
  [flag: string]: unknown;
}

/** An `X` answer for a transaction. Some routes name the hash differently (`stakeTxHash`, `approveTxHash`). */
export interface TxResponse extends SnEnvelope {
  txHash?: string;
  [field: string]: unknown;
}

/** `GET service/get-gas-price-from-latest-block`: the latest block's base fee, in wei. */
export interface GasPriceResponse extends SnEnvelope {
  gasPrice: BigNumberish;
}

/** The gas fields Smartnode reads from a write request (`snroute.go`): gwei as decimals, limit as an integer. */
export interface GasParams {
  maxFee: string;
  maxPrioFee: string;
  gasLimit: string;
}

/* ------------------------------------------------------------------ */
/* Node                                                                */
/* ------------------------------------------------------------------ */

export interface TokenBalances {
  eth: BigNumberish;
  reth: BigNumberish;
  rpl: BigNumberish;
  fixedSupplyRpl?: BigNumberish;
}

/** `feerecipient.Details`. */
export interface FeeRecipientInfo {
  smoothingPoolAddress: string;
  feeDistributorAddress: string;
  megapoolAddress: string;
  hasMinipools: boolean;
  hasMegapoolValidators: boolean;
  isInSmoothingPool: boolean;
  isInOptOutCooldown: boolean;
  optOutEpoch: number;
}

export interface MinipoolCounts {
  total: number;
  initialized: number;
  prelaunch: number;
  staking: number;
  withdrawable: number;
  dissolved: number;
  refundAvailable: number;
  withdrawalAvailable: number;
  closeAvailable: number;
  finalised: number;
}

/** `GET node/status` (`NodeStatusResponse`). */
export interface NodeStatus extends SnEnvelope {
  warning?: string;
  accountAddress: string;
  primaryWithdrawalAddress: string;
  pendingPrimaryWithdrawalAddress: string;
  isRPLWithdrawalAddressSet: boolean;
  rplWithdrawalAddress: string;
  pendingRPLWithdrawalAddress: string;
  registered: boolean;
  trusted: boolean;
  timezoneLocation: string;
  accountBalances: TokenBalances;
  primaryWithdrawalBalances?: TokenBalances;
  totalRplStake: BigNumberish;
  rplStakeMegapool: BigNumberish;
  rplStakeLegacy: BigNumberish;
  /** The legacy RPL stake that must stay while minipools exist (15% of borrowed ETH). */
  rplStakeThreshold?: BigNumberish;
  /** 0.15 today. */
  rplStakeThresholdFraction?: number;
  /** RPL locked on the node (pDAO proposal bonds); it can't be unstaked. */
  nodeRPLLocked?: BigNumberish;
  unstakingRPL: BigNumberish;
  /** RFC 3339. */
  lastRPLUnstakeTime: string;
  /** Nanoseconds (Go time.Duration). */
  unstakingPeriodDuration: BigNumberish;
  /** RFC 3339: the chain's time, to compare with `lastRPLUnstakeTime`. */
  latestBlockTime?: string;
  minipoolCounts: MinipoolCounts;
  isFeeDistributorInitialized: boolean;
  feeRecipientInfo: FeeRecipientInfo;
  feeDistributorBalance: BigNumberish;
  minipools: MinipoolDetails[];
  latestDelegate?: string;
  megapoolDeployed: boolean;
  megapoolAddress: string;
  megapoolActiveValidatorCount: number;
  megapoolNodeDebt: BigNumberish;
  megapoolRefundValue: BigNumberish;
  expressTicketCount: number;
  expressTicketsProvisioned: boolean;
  creditBalance: BigNumberish;
  ethOnBehalfBalance?: BigNumberish;
  unclaimedRewards?: BigNumberish;
  reducedBond?: BigNumberish;
}

/** `GET node/sync` (`NodeSyncProgressResponse`). */
export interface ClientStatus {
  isWorking: boolean;
  isSynced: boolean;
  /** 0..1 */
  syncProgress: number;
  networkId: number;
  error: string;
}

export interface ClientManagerStatus {
  primaryEcStatus: ClientStatus;
  fallbackEnabled: boolean;
  fallbackEcStatus: ClientStatus;
}

export interface NodeSync extends SnEnvelope {
  ecStatus: ClientManagerStatus;
  bcStatus: ClientManagerStatus;
}

/** `GET version`. */
export interface VersionResponse extends SnEnvelope {
  version: string;
}

/* ------------------------------------------------------------------ */
/* Wallet                                                              */
/* ------------------------------------------------------------------ */

/** `GET wallet/status`. */
export interface WalletStatus extends SnEnvelope {
  passwordSet: boolean;
  walletInitialized: boolean;
  accountAddress: string;
  nodeAddress: string;
  isMasquerading: boolean;
  isObserve: boolean;
}

/** `POST wallet/init`: a new recovery phrase. Smartnode does NOT save it: `wallet/recover` does. Secret. */
export interface InitWalletResponse extends SnEnvelope {
  mnemonic: string;
  accountAddress: string;
}

/** `POST wallet/recover` / `wallet/search-and-recover`. */
export interface RecoverWalletResponse extends SnEnvelope {
  accountAddress: string;
  validatorKeys?: string[];
}

/** `POST wallet/export` (needs `typedConfirmation: "EXPORT"`). Secret: never log or keep it. */
export interface WalletExport extends SnEnvelope {
  password: string;
  wallet: string;
  accountPrivateKey: string;
}

/* ------------------------------------------------------------------ */
/* Minipools                                                           */
/* ------------------------------------------------------------------ */

export type MinipoolStatusName = "Initialized" | "Prelaunch" | "Staking" | "Withdrawable" | "Dissolved";

/** One entry of `GET minipool/status` (`MinipoolDetails`). */
export interface MinipoolDetails {
  address: string;
  /** Hex without 0x. */
  validatorPubkey: string;
  status: { status: MinipoolStatusName; statusBlock: number; statusTime: string; isVacant: boolean };
  depositType?: string;
  node: { address: string; fee: number; depositBalance: BigNumberish; refundBalance: BigNumberish; depositAssigned: boolean };
  user?: { depositBalance: BigNumberish; depositAssigned: boolean; depositAssignedTime: string };
  balances: TokenBalances;
  nodeShareOfETHBalance: BigNumberish;
  validator: { exists: boolean; active: boolean; index: string; balance: BigNumberish; nodeBalance: BigNumberish };
  refundAvailable: boolean;
  withdrawalAvailable: boolean;
  closeAvailable: boolean;
  finalised: boolean;
  useLatestDelegate: boolean;
  delegate: string;
  previousDelegate?: string;
  effectiveDelegate: string;
  /** Nanoseconds. */
  timeUntilDissolve?: BigNumberish;
  penalties: number;
}

export interface MinipoolStatusResponse extends SnEnvelope {
  minipools: MinipoolDetails[];
  latestDelegate: string;
}

/** Beacon-chain state names (`beacon.ValidatorState`). */
export type BeaconState =
  | "pending_initialized"
  | "pending_queued"
  | "active_ongoing"
  | "active_exiting"
  | "active_slashed"
  | "exited_unslashed"
  | "exited_slashed"
  | "withdrawal_possible"
  | "withdrawal_done"
  | "";

/** One entry of `GET minipool/get-minipool-close-details-for-node` (`MinipoolCloseDetails`). */
export interface MinipoolCloseDetails {
  address: string;
  isFinalized: boolean;
  minipoolStatus: MinipoolStatusName;
  minipoolVersion: number;
  distributed: boolean;
  canClose: boolean;
  balance: BigNumberish;
  refund: BigNumberish;
  userDepositBalance: BigNumberish;
  beaconState: BeaconState | string;
  nodeShare: BigNumberish;
  gasLimits: GasLimits;
}

/** `GET minipool/get-minipool-close-details-for-node`. No `details` until the fee distributor is initialised. */
export interface MinipoolCloseDetailsResponse extends SnEnvelope {
  expressTicketsProvisioned: boolean;
  isFeeDistributorInitialized: boolean;
  details: MinipoolCloseDetails[] | null;
}

/** One entry of `GET minipool/get-distribute-balance-details` (`MinipoolBalanceDistributionDetails`). */
export interface MinipoolDistributeDetails {
  address: string;
  balance: BigNumberish;
  refund: BigNumberish;
  nodeShareOfBalance: BigNumberish;
  minipoolVersion: number;
  status: MinipoolStatusName;
  isFinalized: boolean;
  canDistribute: boolean;
  gasLimits: GasLimits;
}

export interface MinipoolDistributeDetailsResponse extends SnEnvelope {
  details: MinipoolDistributeDetails[] | null;
}

/* ------------------------------------------------------------------ */
/* Megapool                                                            */
/* ------------------------------------------------------------------ */

/** Beacon-chain validator state (`beacon.ValidatorStatus`). */
export interface BeaconValidatorStatus {
  pubkey: string;
  index: string;
  balance: number;
  status: string;
  effective_balance: number;
  slashed: boolean;
  activation_epoch: number;
  /** FAR_FUTURE_EPOCH (2^64 - 1) while not exiting, so a string then. */
  exit_epoch: BigNumberish;
  withdrawable_epoch: BigNumberish;
  exists: boolean;
}

/** `MegapoolValidatorDetails`. */
export interface MegapoolValidator {
  validatorId: number;
  /** Hex without 0x. */
  pubKey: string;
  staked: boolean;
  exited: boolean;
  inQueue: boolean;
  queuePosition: BigNumberish;
  inPrestake: boolean;
  expressUsed: boolean;
  dissolved: boolean;
  exiting: boolean;
  locked: boolean;
  validatorIndex: number;
  exitBalance: number;
  withdrawableEpoch: number;
  activated: boolean;
  beaconStatus: BeaconValidatorStatus;
}

/** `MegapoolDetails`. */
export interface MegapoolDetails {
  address: string;
  delegate: string;
  effectiveDelegateAddress: string;
  deployed: boolean;
  validatorCount: number;
  activeValidatorCount: number;
  exitingValidatorCount: number;
  lockedValidatorCount: number;
  nodeDebt: BigNumberish;
  refundValue: BigNumberish;
  delegateExpiry: number;
  delegateExpired: boolean;
  pendingRewards: BigNumberish;
  nodeExpressTicketCount: number;
  useLatestDelegate: boolean;
  nodeBond: BigNumberish;
  nodeQueuedBond: BigNumberish;
  userCapital: BigNumberish;
  bondRequirement: BigNumberish;
  balances: TokenBalances;
  lastDistributionTime: number;
  validators: MegapoolValidator[];
}

/** `GET megapool/status` (`MegapoolStatusResponse`). */
export interface MegapoolStatusResponse extends SnEnvelope {
  megapoolDetails: MegapoolDetails;
  latestDelegate: string;
  beaconHead: { Epoch: number; FinalizedEpoch: number; JustifiedEpoch: number; PreviousJustifiedEpoch: number };
  shardCommitteePeriod?: number;
  secondsPerEpoch?: number;
}

/** `GET megapool/pending-rewards`. `rewardSplit` has Go field names (no JSON tags in Smartnode). */
export interface MegapoolPendingRewards extends SnEnvelope {
  rewardSplit: { NodeRewards: BigNumberish; VoterRewards: BigNumberish; ProtocolDAORewards: BigNumberish; RethRewards: BigNumberish };
  refundValue: BigNumberish;
}

/** `GET megapool/can-distribute`. */
export interface CanDistributeMegapool extends CanResponse {
  canDistribute: boolean;
  megapoolNotDeployed: boolean;
  lastDistributionTime: number;
  lockedValidatorCount: number;
  exitingValidatorCount: number;
}

/** `GET node/can-distribute` (the fee distributor). `nodeShare` is ETH as a float (Smartnode's own type). */
export interface CanDistributeFeeDistributor extends CanResponse {
  balance: BigNumberish;
  nodeShare: number;
}

/** `GET node/get-bond-requirement?numValidators=N`: the total bond for a megapool with N validators. */
export interface BondRequirementResponse extends SnEnvelope {
  bondRequirement: BigNumberish;
}

/** `GET node/stake-rpl-allowance`: how much RPL the staking contract may take. */
export interface RplAllowanceResponse extends SnEnvelope {
  allowance: BigNumberish;
}

/** `GET node/can-deposit` (`CanNodeDepositsResponse`). */
export interface CanDepositResponse extends CanResponse {
  canDeposit: boolean;
  creditBalance: BigNumberish;
  usableCreditBalance?: BigNumberish;
  /** The deposit pool's balance (caps how much credit can be used). */
  depositBalance?: BigNumberish;
  /** Credit can pay for (part of) this deposit. */
  canUseCredit?: boolean;
  nodeBalance: BigNumberish;
  insufficientBalance: boolean;
  /** There is credit, but the deposit pool can't take it now and the wallet alone isn't enough. */
  insufficientBalanceWithoutCredit?: boolean;
  invalidAmount: boolean;
  depositDisabled: boolean;
  inConsensus?: boolean;
  nodeHasDebt?: boolean;
  megapoolAddress?: string;
  validatorPubkeys?: string[];
}

/** `POST node/deposit` with `submit=true` (`NodeDepositsResponse`). */
export interface NodeDepositResponse extends TxResponse {
  validatorPubkeys?: string[];
  /** Nanoseconds. */
  scrubPeriod?: BigNumberish;
}

/** `GET node/can-register` (`CanRegisterNodeResponse`). */
export interface CanRegisterResponse extends CanResponse {
  canRegister: boolean;
  alreadyRegistered: boolean;
  registrationDisabled: boolean;
}

/** `GET node/can-set-primary-withdrawal-address`: the flag is `canSet`, not named after the route. */
export interface CanSetWithdrawalAddressResponse extends CanResponse {
  canSet: boolean;
}

/* ------------------------------------------------------------------ */
/* Rewards                                                             */
/* ------------------------------------------------------------------ */

/** `rewards.IntervalInfo` (amounts are quoted strings). */
export interface RewardsInterval {
  index: number;
  treeFileExists: boolean;
  merkleRootValid: boolean;
  startTime: string;
  endTime: string;
  nodeExists: boolean;
  collateralRplAmount: BigNumberish;
  oDaoRplAmount: BigNumberish;
  smoothingPoolEthAmount: BigNumberish;
  voterShareEth?: BigNumberish;
  totalEthAmount?: BigNumberish;
}

/** `GET node/get-rewards-info`. */
export interface RewardsInfo extends SnEnvelope {
  registered: boolean;
  claimedIntervals: number[];
  unclaimedIntervals: RewardsInterval[];
  invalidIntervals: RewardsInterval[];
  rplStake: BigNumberish;
  rplPrice: BigNumberish;
  activeMinipools: number;
  activeMegapoolValidators: number;
}

/** `GET node/get-smoothing-pool-registration-status`. */
export interface SmoothingPoolStatus extends SnEnvelope {
  nodeRegistered: boolean;
  /** Nanoseconds. */
  timeLeftUntilChangeable: BigNumberish;
}

/* ------------------------------------------------------------------ */
/* AVADO backend (/api/avado/*)                                        */
/* ------------------------------------------------------------------ */

/**
 * A supervisord state name: RUNNING, STARTING, BACKOFF, STOPPING, STOPPED,
 * EXITED, FATAL; UNKNOWN when supervisord can't be asked.
 */
export type DaemonStateName = string;

export interface DaemonState {
  state: DaemonStateName;
  description?: string;
  /** ISO time the daemon started, when running. */
  since?: string;
  exitStatus?: number;
  error?: string;
}

export interface BackupInfo {
  name: string;
  createdAt: string;
  /**
   * "mnemonic-archive": the old plaintext recovery-phrase file, moved there by `POST /api/avado/legacy-mnemonic/archive`.
   * "wallet-create": made right after the wallet was first saved. "manual": made for a download of "current".
   */
  kind: "upgrade" | "wallet-change" | "wallet-create" | "manual" | "mnemonic-archive";
}

/** `GET /api/avado/status`. */
export interface AvadoStatus {
  packageVersion: string | null;
  network: string;
  networkSupported: boolean;
  daemon: DaemonState;
  /** Smartnode's API answers /healthz. */
  apiReachable: boolean;
  apiTokenPresent: boolean;
  /** Why the start script refused to start the daemon (redacted), if it did. */
  startupError: string | null;
  /** Recent error lines from the daemon log (redacted), at most 20. */
  daemonErrors: string[];
  /** Newest first. */
  backups: BackupInfo[];
  walletFilePresent: boolean;
  passwordFilePresent: boolean;
  /** The old package's plaintext recovery-phrase file is still in the data dir. */
  legacyMnemonicPresent: boolean;
  /**
   * The daemon's gas settings as rendered on start (strings, as in
   * user-settings.yml). Only from a backend that reports them; the UI falls
   * back to the package template's values.
   */
  settings?: DaemonSettings;
}

export interface DaemonSettings {
  /** gwei: automatic transactions wait until the network's max fee is below this. */
  autoTxGasThreshold?: string;
  /** ETH: a minipool's balance is distributed automatically above this. */
  distributeThreshold?: string;
  /** gwei; 0 = use the network estimate. */
  manualMaxFee?: string;
  /** gwei: the tip on the daemon's own transactions. */
  priorityFee?: string;
}

/** The loop's verdict on its last pass. */
export type ReconcileState = "ok" | "waiting" | "attention" | "error";

/** The status file version this UI was written for (backend STATUS_VERSION). */
export const RECONCILE_STATUS_VERSION = 2;

/**
 * One Rocket Pool key after the last pass (backend `reconcile/run.ts`
 * KeyState, v2). `unknown`: a state this UI doesn't know (a newer backend);
 * it counts as "not running".
 */
export type ReconcileKeyState =
  | "loaded"
  | "imported"
  | "loaded-twice"
  | "elsewhere"
  | "awaiting-approval"
  | "settling"
  | "import-blocked"
  | "client-update-needed"
  | "missing-keystore"
  | "import-failed"
  | "retry-limit"
  | "deferred"
  | "no-client"
  | "unknown";

export type ReconcileFeeState = "ok" | "fixed" | "failed" | "no-address" | "not-loaded";

export interface ReconcileKey {
  /** 96 hex, no 0x. */
  pubkey: string;
  kind: "minipool" | "megapool";
  /** Minipool address, or the megapool validator id. */
  ref: string;
  state: ReconcileKeyState;
  /** The state as the backend wrote it (differs from `state` only for `unknown`). */
  rawState: string;
  /** Packages the key is loaded in after the pass. */
  loadedIn: string[];
  /** For "settling": when the key may be loaded. */
  settlesAt?: string;
  feeRecipient: {
    rule: string;
    expected: string | null;
    /** Worst result over the clients the key is loaded in. */
    state: ReconcileFeeState;
    clients: Array<{ package: string; found?: string | null; state: ReconcileFeeState; error?: string }>;
  };
  error?: string;
}

export interface ReconcileClient {
  id: string;
  /** "Teku" */
  name: string;
  package: string;
}

/** An installed consensus client as the pass saw it (v2 `clients[]`). */
export interface ReconcileClientReport extends ReconcileClient {
  version: string | null;
  chosen: boolean;
  /** Its key list was read. */
  checked: boolean;
  error?: string;
  rocketPoolKeys: number;
  feeRecipients: { ok: number; fixed: number; failed: number };
}

/**
 * The key/fee-recipient loop's status (`/tmp/reconcile-status.json`, backend
 * `reconcile/run.ts` ReconcileStatus, version 2), after `parseReconcileStatus`:
 * every field present, with safe defaults for anything missing or malformed.
 */
export interface ReconcileStatus {
  version: number;
  /** Written by a newer backend than this UI knows: some of it may not be shown. */
  newerThanUi: boolean;
  state: ReconcileState;
  /** One plain-language line, e.g. "Validator keys in sync with Teku: 3/3." */
  message: string;
  startedAt: string | null;
  /** When the last pass ended: compare with an earlier value to see that a requested run is done. */
  finishedAt: string | null;
  trigger: "startup" | "timer" | "request" | null;
  nextRunAt: string | null;
  /** The consensus client the keys belong in; null when none could be chosen. */
  client: ReconcileClient | null;
  /** CONSENSUSCLIENT as set in the package. */
  configuredClient: string | null;
  /** How the client was chosen, in plain language (`why`). */
  clientChoice: { source: "setting" | "only-installed" | "none"; why: string } | null;
  /** Keys missing everywhere that are only loaded after the owner approves them (96 hex, no 0x). */
  awaitingApproval: string[];
  /** Why approved keys can't be loaded right now; show next to the approval prompt. */
  importBlockedReasons: string[];
  /** Keys loaded in two installed clients at once: slashing danger. */
  loadedTwice: Array<{ pubkey: string; packages: string[] }>;
  /** Every installed known client, the chosen one included. */
  clients: ReconcileClientReport[];
  unknownValidatorPackages: string[];
  keys: { total: number; inSync: number; imported: number; summary: string };
  feeRecipients: { total: number; ok: number; fixed: number; failed: number };
  validators: ReconcileKey[];
  /** Plain-language problems from the pass. */
  errors: string[];
}

/** `GET /api/avado/reconcile`. `status` is raw: read it through `parseReconcileStatus`. */
export interface ReconcileView {
  /** false until the loop has written a status. */
  available: boolean;
  /**
   * A run was asked for and hasn't started yet. It turns false when the run
   * starts, not when it ends: watch `finishedAt` for the end.
   */
  runRequested: boolean;
  status?: unknown;
  updatedAt?: string;
  error?: string;
}

/** The exact text the owner types to approve loading keys (backend APPROVE_CONFIRMATION). */
export const APPROVE_CONFIRMATION = "LOAD";

/** `POST /api/avado/reconcile/approve` answer (202). */
export interface ApproveKeysResult extends SnEnvelope {
  /** Keys in the request (deduplicated). */
  approved: number;
  /** Of those, newly added to the approved list. */
  added: number;
  runRequested: boolean;
}

/** The exact text the owner types to move the old plaintext recovery-phrase file into the backups folder. */
export const ARCHIVE_CONFIRMATION = "ARCHIVE";

/** `POST /api/avado/legacy-mnemonic/archive` answer (200). */
export interface LegacyMnemonicArchiveResult extends SnEnvelope {
  archived: boolean;
  /** The backup folder it was moved into, e.g. "mnemonic-archive-20260923T101500Z". */
  name: string;
}

/** `name` for `POST /api/avado/backups/download` that makes a fresh backup of the wallet, its password and the validator keys. */
export const CURRENT_BACKUP = "current";

/** `POST /api/avado/backups/download`: the backup as a .zip file, ready to save. */
export interface BackupDownload {
  blob: Blob;
  /** A safe file name for the owner's downloads folder, e.g. "rocketpool-backup-20260923T101500Z.zip". */
  fileName: string;
}

/** `GET /api/avado/logs?tail=N`. */
export interface LogsView {
  available: boolean;
  lines: string[];
}
