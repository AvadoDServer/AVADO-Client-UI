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
  rplStakeThreshold?: BigNumberish;
  unstakingRPL: BigNumberish;
  /** RFC 3339. */
  lastRPLUnstakeTime: string;
  /** Nanoseconds (Go time.Duration). */
  unstakingPeriodDuration: BigNumberish;
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

/** `GET node/can-deposit` (`CanNodeDepositsResponse`). */
export interface CanDepositResponse extends CanResponse {
  canDeposit: boolean;
  creditBalance: BigNumberish;
  usableCreditBalance?: BigNumberish;
  nodeBalance: BigNumberish;
  insufficientBalance: boolean;
  invalidAmount: boolean;
  depositDisabled: boolean;
  nodeHasDebt?: boolean;
  megapoolAddress?: string;
  validatorPubkeys?: string[];
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
  kind: "upgrade" | "wallet-change";
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
}

/**
 * The reconcile loop's status file (`/tmp/reconcile-status.json`, written by
 * the backend's key/fee-recipient loop). The shape the UI reads; every field
 * is optional so an older or partial file never breaks the page.
 */
export interface ReconcileStatus {
  /** ISO time of the last finished run. */
  lastRunAt?: string;
  /** The consensus client the keys are loaded in; null when none is installed. */
  client?: { package: string; title: string } | null;
  keys?: {
    /** Rocket Pool validator keys this node has. */
    total: number;
    /** Of those, loaded in the consensus client. */
    loaded: number;
    /** Imported by the last run. */
    imported?: number;
    /** Not imported because another AVADO consensus client already has them (no double signing). */
    inOtherClient?: number;
  };
  feeRecipients?: {
    total: number;
    /** Keys whose fee recipient is right. */
    correct: number;
    /** Corrected by the last run. */
    fixed?: number;
  };
  /** Plain-language problems from the last run. */
  errors?: string[];
}

/** `GET /api/avado/reconcile`. */
export interface ReconcileView {
  /** false until the loop has written a status. */
  available: boolean;
  /** A run was asked for and hasn't started yet. */
  runRequested: boolean;
  status?: ReconcileStatus;
  updatedAt?: string;
  error?: string;
}

/** `GET /api/avado/logs?tail=N`. */
export interface LogsView {
  available: boolean;
  lines: string[];
}
