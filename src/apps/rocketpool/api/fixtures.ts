/**
 * Demo data for `VITE_MOCK=1` and tests: four nodes, shaped like the real
 * answers of the package backend and Smartnode v1.24.2.
 *
 *  - `minipool`: an existing operator with two minipools (the typical AVADO
 *    node today), in the smoothing pool, cold withdrawal address.
 *  - `mixed`: one minipool plus a megapool with two validators (one active,
 *    one in the queue), not in the smoothing pool, withdrawal address still
 *    the hot wallet, little ETH left for gas.
 *  - `fresh`: a new install: daemon running, no wallet yet. Creating or
 *    restoring a wallet in the mock turns it into `unregistered`.
 *  - `unregistered`: a wallet with 8.2 ETH, not registered with Rocket Pool yet.
 *  - `new-node`: registered, no validators yet, a cold withdrawal address
 *    waiting for its confirmation, not in the smoothing pool.
 *  - `keys-attention`: every key-check state the Home page explains: keys
 *    awaiting approval (with a reason they can't load yet), a key settling,
 *    a key loaded in two clients, and one waiting for a Teku update.
 *  - `daemon-failed`: the daemon would not start (bad settings); its API is down.
 *  - `exits`: winding down: a minipool exited and ready to close, one still
 *    staking; a megapool with validators exiting, locked and queued, a debt,
 *    a refund and credit; RPL unstaking.
 *
 * Big integers follow the wire format: a number when it is a safe integer,
 * else a string with the exact digits.
 */
import type {
  AvadoStatus,
  CanDepositResponse,
  GasPriceResponse,
  MegapoolDetails,
  MegapoolStatusResponse,
  MegapoolValidator,
  MinipoolDetails,
  MinipoolStatusResponse,
  NodeStatus,
  NodeSync,
  ReconcileView,
  RewardsInfo,
  SmoothingPoolStatus,
  VersionResponse,
  WalletStatus,
} from "./models";

/** Deterministic fake hex (no 0x) of `bytes` bytes: looks real, stays stable. */
export function demoHex(seed: number, bytes: number): string {
  let x = (seed * 2654435761) >>> 0 || 1;
  let out = "";
  for (let i = 0; i < bytes; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out += (x & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}

const address = (seed: number) => `0x${demoHex(seed, 20)}`;
const pubkey = (seed: number) => demoHex(500 + seed, 48);

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** wei from a decimal ETH amount, in the backend's wire format. */
export function eth(amount: string): string | number {
  const [whole, frac = ""] = amount.split(".");
  const wei = BigInt(whole) * 10n ** 18n + BigInt(frac.padEnd(18, "0").slice(0, 18) || "0");
  return wei <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(wei) : wei.toString();
}

/** A Smartnode error answer (HTTP status + message) for a route in a scenario. */
export class DemoSnError {
  constructor(
    readonly status: number,
    readonly message: string,
  ) {}
}

export type MockScenarioName = "minipool" | "mixed" | "fresh" | "unregistered" | "new-node" | "keys-attention" | "daemon-failed" | "exits";

export const MOCK_SCENARIOS: readonly MockScenarioName[] = [
  "minipool",
  "mixed",
  "fresh",
  "unregistered",
  "new-node",
  "keys-attention",
  "daemon-failed",
  "exits",
];

export interface MockScenario {
  name: MockScenarioName;
  title: string;
  avado: AvadoStatus;
  reconcile: ReconcileView;
  /** Smartnode read routes → the answer (or a `DemoSnError`). */
  reads: Record<string, unknown>;
  /** Smartnode's API is down: every `/api/sn/*` call gets the backend's 502. */
  daemonDown?: boolean;
  /** Recent log lines for the logs view. */
  logLines: string[];
}

/* ------------------------------------------------------------------ */

export const DEMO = {
  nodeAddress: address(1),
  coldWallet: address(2),
  smoothingPool: "0xd4e96ef8eee8678dbff4d535e033ed1a4f7605b7",
  feeDistributor: address(3),
  megapool: address(4),
  minipoolA: address(10),
  minipoolB: address(11),
  minipoolC: address(12),
  delegate: address(20),
  /** An older megapool delegate (the exits node hasn't updated to the latest yet). */
  oldDelegate: address(21),
  pubkeyA: pubkey(1),
  pubkeyB: pubkey(2),
  pubkeyC: pubkey(3),
  megaPubkey1: pubkey(4),
  megaPubkey2: pubkey(5),
  minipoolD: address(13),
  minipoolE: address(14),
  pubkeyD: pubkey(6),
  pubkeyE: pubkey(7),
  megaPubkey3: pubkey(8),
  megaPubkey4: pubkey(9),
  megaPubkey5: pubkey(10),
} as const;

const NOW = "2026-09-23T10:00:00Z";
const GAS_PRICE: GasPriceResponse = { status: "success", error: "", gasPrice: 850_000_000 }; // 0.85 gwei base fee
const VERSION: VersionResponse = { status: "success", error: "", version: "1.24.2" };

const synced = { isWorking: true, isSynced: true, syncProgress: 1, networkId: 1, error: "" };
const unused = { isWorking: false, isSynced: false, syncProgress: 0, networkId: 0, error: "" };
const NODE_SYNC: NodeSync = {
  status: "success",
  error: "",
  ecStatus: { primaryEcStatus: synced, fallbackEnabled: false, fallbackEcStatus: unused },
  bcStatus: { primaryEcStatus: synced, fallbackEnabled: false, fallbackEcStatus: unused },
};

const baseAvado: AvadoStatus = {
  packageVersion: "1.0.0",
  network: "mainnet",
  networkSupported: true,
  daemon: { state: "RUNNING", description: "pid 42, uptime 3 days", since: "2026-09-20T08:12:00Z" },
  apiReachable: true,
  apiTokenPresent: true,
  startupError: null,
  daemonErrors: [],
  backups: [{ name: "0.0.106-20260920T081100Z", createdAt: "2026-09-20T08:11:00Z", kind: "upgrade" }],
  walletFilePresent: true,
  passwordFilePresent: true,
  legacyMnemonicPresent: false,
};

const walletStatus = (initialized: boolean): WalletStatus => ({
  status: "success",
  error: "",
  passwordSet: initialized,
  walletInitialized: initialized,
  accountAddress: initialized ? DEMO.nodeAddress : ZERO_ADDRESS,
  nodeAddress: initialized ? DEMO.nodeAddress : ZERO_ADDRESS,
  isMasquerading: false,
  isObserve: false,
});

function minipool(
  addr: string,
  key: string,
  seed: { index: string; bond: string; fee: number; balance: string; nodeShare: string },
): MinipoolDetails {
  return {
    address: addr,
    validatorPubkey: key,
    status: { status: "Staking", statusBlock: 17_034_512, statusTime: "2023-04-14T09:21:11Z", isVacant: false },
    depositType: "Variable",
    node: { address: DEMO.nodeAddress, fee: seed.fee, depositBalance: eth(seed.bond), refundBalance: 0, depositAssigned: true },
    user: { depositBalance: eth(String(32 - Number(seed.bond))), depositAssigned: true, depositAssignedTime: "2023-04-14T09:21:11Z" },
    balances: { eth: eth("0.0412"), reth: 0, rpl: 0, fixedSupplyRpl: 0 },
    nodeShareOfETHBalance: eth("0.0187"),
    validator: { exists: true, active: true, index: seed.index, balance: eth(seed.balance), nodeBalance: eth(seed.nodeShare) },
    refundAvailable: false,
    withdrawalAvailable: false,
    closeAvailable: false,
    finalised: false,
    useLatestDelegate: false,
    delegate: DEMO.delegate,
    previousDelegate: ZERO_ADDRESS,
    effectiveDelegate: DEMO.delegate,
    timeUntilDissolve: 0,
    penalties: 0,
  };
}

const MINIPOOL_A = minipool(DEMO.minipoolA, DEMO.pubkeyA, { index: "612345", bond: "8", fee: 0.14, balance: "32.0412", nodeShare: "8.0187" });
const MINIPOOL_B = minipool(DEMO.minipoolB, DEMO.pubkeyB, { index: "612346", bond: "16", fee: 0.15, balance: "32.0381", nodeShare: "16.0214" });
const MINIPOOL_C = minipool(DEMO.minipoolC, DEMO.pubkeyC, { index: "498211", bond: "8", fee: 0.14, balance: "32.0295", nodeShare: "8.0133" });

const counts = (staking: number) => ({
  total: staking,
  initialized: 0,
  prelaunch: 0,
  staking,
  withdrawable: 0,
  dissolved: 0,
  refundAvailable: 0,
  withdrawalAvailable: 0,
  closeAvailable: 0,
  finalised: 0,
});

const FAR_FUTURE_EPOCH = "18446744073709551615";

const beacon = (key: string, index: string, status: string, balance: number, activation: number) => ({
  pubkey: key,
  index,
  balance,
  status,
  effective_balance: Math.min(balance, 32_000_000_000),
  slashed: false,
  activation_epoch: activation,
  exit_epoch: FAR_FUTURE_EPOCH,
  withdrawable_epoch: FAR_FUTURE_EPOCH,
  exists: status !== "",
});

type MegaState = "active" | "queued" | "exiting" | "locked" | "exited";

function megaValidator(id: number, key: string, state: MegaState, index = 2_104_551 + id): MegapoolValidator {
  const onBeacon = state !== "queued";
  const beaconState = { active: "active_ongoing", queued: "", exiting: "active_exiting", locked: "withdrawal_possible", exited: "withdrawal_done" }[state];
  return {
    validatorId: id,
    pubKey: key,
    staked: onBeacon,
    exited: state === "exited",
    inQueue: state === "queued",
    queuePosition: state === "queued" ? 214 : 0,
    inPrestake: false,
    expressUsed: state === "active",
    dissolved: false,
    exiting: state === "exiting",
    locked: state === "locked",
    validatorIndex: onBeacon ? index : 0,
    exitBalance: state === "exited" ? 32_011_204_118 : 0,
    withdrawableEpoch: state === "exiting" || state === "locked" ? 413_056 : 0,
    activated: onBeacon,
    beaconStatus: onBeacon
      ? {
          ...beacon(key, String(index), beaconState, state === "exited" ? 0 : 32_004_812_331, 401_220),
          ...(state === "exiting" || state === "locked" ? { exit_epoch: 412_800, withdrawable_epoch: 413_056 } : {}),
        }
      : beacon(key, "", "", 0, 0),
  };
}

const MEGAPOOL: MegapoolDetails = {
  address: DEMO.megapool,
  delegate: DEMO.delegate,
  effectiveDelegateAddress: DEMO.delegate,
  deployed: true,
  validatorCount: 2,
  activeValidatorCount: 1,
  exitingValidatorCount: 0,
  lockedValidatorCount: 0,
  nodeDebt: 0,
  refundValue: 0,
  delegateExpiry: 1_830_000_000,
  delegateExpired: false,
  pendingRewards: eth("0.0214"),
  nodeExpressTicketCount: 1,
  useLatestDelegate: true,
  nodeBond: eth("8"),
  nodeQueuedBond: eth("4"),
  userCapital: eth("28"),
  bondRequirement: eth("8"),
  balances: { eth: eth("0.0214"), reth: 0, rpl: 0 },
  lastDistributionTime: 1_755_000_000,
  validators: [megaValidator(0, DEMO.megaPubkey1, "active"), megaValidator(1, DEMO.megaPubkey2, "queued")],
};

const NO_MEGAPOOL: MegapoolDetails = {
  ...MEGAPOOL,
  address: DEMO.megapool,
  deployed: false,
  validatorCount: 0,
  activeValidatorCount: 0,
  pendingRewards: 0,
  nodeExpressTicketCount: 2,
  nodeBond: 0,
  nodeQueuedBond: 0,
  userCapital: 0,
  balances: { eth: 0, reth: 0, rpl: 0 },
  lastDistributionTime: 0,
  validators: [],
};

const megapoolStatus = (details: MegapoolDetails): MegapoolStatusResponse => ({
  status: "success",
  error: "",
  megapoolDetails: details,
  latestDelegate: DEMO.delegate,
  beaconHead: { Epoch: 412_800, FinalizedEpoch: 412_798, JustifiedEpoch: 412_799, PreviousJustifiedEpoch: 412_798 },
  shardCommitteePeriod: 256,
  secondsPerEpoch: 384,
});

const minipoolStatus = (minipools: MinipoolDetails[]): MinipoolStatusResponse => ({
  status: "success",
  error: "",
  minipools,
  latestDelegate: DEMO.delegate,
});

function nodeStatus(o: {
  withdrawal: string;
  eth: string;
  rpl: string;
  legacyRpl: string;
  minipools: MinipoolDetails[];
  megapool: MegapoolDetails;
  smoothingPool: boolean;
  unclaimed: string;
  registered?: boolean;
  pendingWithdrawal?: string;
  extra?: Partial<NodeStatus>;
}): NodeStatus {
  const hasMegapool = o.megapool.deployed && o.megapool.validatorCount > 0;
  const status: NodeStatus = {
    status: "success",
    error: "",
    warning: "",
    accountAddress: DEMO.nodeAddress,
    primaryWithdrawalAddress: o.withdrawal,
    pendingPrimaryWithdrawalAddress: o.pendingWithdrawal ?? ZERO_ADDRESS,
    isRPLWithdrawalAddressSet: false,
    rplWithdrawalAddress: o.withdrawal,
    pendingRPLWithdrawalAddress: ZERO_ADDRESS,
    registered: o.registered ?? true,
    trusted: false,
    timezoneLocation: o.registered === false ? "" : "Europe/Ljubljana",
    accountBalances: { eth: eth(o.eth), reth: 0, rpl: eth(o.rpl), fixedSupplyRpl: 0 },
    totalRplStake: eth(o.legacyRpl),
    rplStakeMegapool: 0,
    rplStakeLegacy: eth(o.legacyRpl),
    rplStakeThreshold: eth("310.5"),
    unstakingRPL: 0,
    lastRPLUnstakeTime: "0001-01-01T00:00:00Z",
    unstakingPeriodDuration: 2_419_200_000_000_000, // 28 days in ns
    minipoolCounts: counts(o.minipools.length),
    isFeeDistributorInitialized: o.minipools.length > 0,
    feeRecipientInfo: {
      smoothingPoolAddress: DEMO.smoothingPool,
      feeDistributorAddress: DEMO.feeDistributor,
      megapoolAddress: DEMO.megapool,
      hasMinipools: o.minipools.length > 0,
      hasMegapoolValidators: hasMegapool,
      isInSmoothingPool: o.smoothingPool,
      isInOptOutCooldown: false,
      optOutEpoch: 0,
    },
    feeDistributorBalance: eth("0.0931"),
    minipools: o.minipools,
    latestDelegate: DEMO.delegate,
    megapoolDeployed: o.megapool.deployed,
    megapoolAddress: DEMO.megapool,
    megapoolActiveValidatorCount: o.megapool.activeValidatorCount,
    megapoolNodeDebt: 0,
    megapoolRefundValue: 0,
    expressTicketCount: o.megapool.nodeExpressTicketCount,
    expressTicketsProvisioned: true,
    creditBalance: 0,
    ethOnBehalfBalance: 0,
    unclaimedRewards: eth(o.unclaimed),
    reducedBond: 0,
    rplStakeThresholdFraction: 0.15,
    nodeRPLLocked: 0,
    latestBlockTime: NOW,
  };
  return { ...status, ...o.extra };
}

const interval = (index: number, rpl: string, ethAmount: string) => ({
  index,
  treeFileExists: true,
  merkleRootValid: true,
  startTime: "2026-08-14T02:00:00Z",
  endTime: "2026-09-11T02:00:00Z",
  nodeExists: true,
  collateralRplAmount: String(BigInt(eth(rpl))),
  oDaoRplAmount: "0",
  smoothingPoolEthAmount: String(BigInt(eth(ethAmount))),
});

const rewardsInfo = (o: { minipools: number; megapool: number; unclaimed: ReturnType<typeof interval>[]; stake: string }): RewardsInfo => ({
  status: "success",
  error: "",
  registered: true,
  claimedIntervals: [38, 39, 40, 41],
  unclaimedIntervals: o.unclaimed,
  invalidIntervals: [],
  rplStake: eth(o.stake),
  rplPrice: eth("0.00321"),
  activeMinipools: o.minipools,
  activeMegapoolValidators: o.megapool,
});

/** `node/can-deposit` for a node with `balance` ETH and no credit (the demo ignores the amount asked). */
const canDeposit = (balance: string, enough: boolean): CanDepositResponse => ({
  status: "success",
  error: "",
  canDeposit: enough,
  creditBalance: 0,
  usableCreditBalance: 0,
  depositBalance: eth("1250"),
  canUseCredit: false,
  nodeBalance: eth(balance),
  insufficientBalance: !enough,
  insufficientBalanceWithoutCredit: false,
  invalidAmount: false,
  depositDisabled: false,
  inConsensus: false,
  nodeHasDebt: false,
  megapoolAddress: DEMO.megapool,
  validatorPubkeys: [],
  ...(enough ? { gasLimits: { estimated: 1_450_000, safe: 2_175_000 } } : {}),
});

const spStatus = (registered: boolean): SmoothingPoolStatus => ({ status: "success", error: "", nodeRegistered: registered, timeLeftUntilChangeable: 0 });

const sharedReads = {
  version: VERSION,
  "node/sync": NODE_SYNC,
  "service/get-gas-price-from-latest-block": GAS_PRICE,
};

const NORMAL_LOG = [
  "2026/09/23 09:55:02 Checking for minipools to distribute...",
  "2026/09/23 09:55:03 Current network gas price is 0.85 gwei (max fee threshold 5 gwei).",
  "2026/09/23 09:58:40 Node is in sync.",
];


/* ------------------------------------------------------------------ */
/* Key check (backend reconcile loop, status version 1)                 */
/* ------------------------------------------------------------------ */

const NIMBUS = { id: "nimbus", name: "Nimbus", package: "nimbus.avado.dnp.dappnode.eth" };
const TEKU = { id: "teku", name: "Teku", package: "teku.avado.dnp.dappnode.eth" };

type DemoKeyState =
  | "loaded"
  | "imported"
  | "loaded-twice"
  | "elsewhere"
  | "awaiting-approval"
  | "settling"
  | "import-blocked"
  | "client-update-needed"
  | "missing-keystore";

/** One validator entry of the status file (v2). `loadedIn` defaults to Nimbus for loaded keys. */
export function demoKey(
  pubkeyHex: string,
  kind: "minipool" | "megapool",
  ref: string,
  state: DemoKeyState,
  rule: string,
  expected: string,
  fee: "ok" | "fixed" = "ok",
  loadedIn?: string[],
) {
  const loaded = state === "loaded" || state === "imported" || state === "loaded-twice" || state === "elsewhere";
  const where = loadedIn ?? (loaded ? ["nimbus.avado.dnp.dappnode.eth"] : []);
  return {
    pubkey: pubkeyHex,
    kind,
    ref,
    state,
    loadedIn: where,
    ...(state === "settling" ? { settlesAt: "2026-09-23T10:20:00Z" } : {}),
    feeRecipient: {
      rule,
      expected,
      state: loaded ? fee : "not-loaded",
      clients: where.map((p) => ({ package: p, found: fee === "fixed" ? ZERO_ADDRESS : expected, state: fee })),
    },
  };
}


/** A `GET /api/avado/reconcile` answer with a status built like the loop's (status file version 2). */
export function reconcileView(o: {
  state: "ok" | "waiting" | "attention" | "error";
  client: { id: string; name: string; package: string } | null;
  keys: ReturnType<typeof demoKey>[];
  message?: string;
  errors?: string[];
  importBlockedReasons?: string[];
}): ReconcileView {
  const chosen = o.client?.package ?? null;
  const inSync = o.keys.filter((k) => chosen !== null && k.loadedIn.includes(chosen)).length;
  const awaiting = o.keys.filter((k) => k.state === "awaiting-approval").map((k) => k.pubkey);
  const twice = o.keys.filter((k) => k.loadedIn.length > 1).map((k) => ({ pubkey: k.pubkey, packages: k.loadedIn }));
  const fees = o.keys.map((k) => k.feeRecipient.state);
  const summary = `${inSync}/${o.keys.length}`;
  const name = o.client?.name ?? "";
  const packages = [...new Set([...(chosen ? [chosen] : []), ...o.keys.flatMap((k) => k.loadedIn)])];
  const message =
    o.message ??
    `Validator keys in sync with ${name}: ${summary}.` +
      (awaiting.length ? ` ${awaiting.length} validator key${awaiting.length === 1 ? " is" : "s are"} not loaded and wait${awaiting.length === 1 ? "s" : ""} for your approval.` : "");
  const title = (p: string) => ({ "nimbus.avado.dnp.dappnode.eth": "Nimbus", "teku.avado.dnp.dappnode.eth": "Teku", "eth2validator.avado.dnp.dappnode.eth": "Prysm", "lighthouse.avado.dnp.dappnode.eth": "Lighthouse" })[p] ?? p;
  return {
    available: true,
    runRequested: false,
    updatedAt: NOW,
    status: {
      version: 2,
      state: o.state,
      message,
      startedAt: "2026-09-23T09:59:58Z",
      finishedAt: NOW,
      durationMs: 2140,
      trigger: "timer",
      nextRunAt: "2026-09-23T10:05:00Z",
      client: o.client,
      configuredClient: o.client?.id ?? null,
      clientChoice: o.client
        ? { source: "setting", why: `The Rocket Pool package setting CONSENSUSCLIENT is "${o.client.id}".` }
        : null,
      awaitingApproval: awaiting,
      importBlockedReasons: o.importBlockedReasons ?? [],
      loadedTwice: twice,
      clients: packages.map((p) => ({
        id: title(p).toLowerCase(),
        name: title(p),
        package: p,
        version: "0.0.80",
        chosen: p === chosen,
        checked: true,
        rocketPoolKeys: o.keys.filter((k) => k.loadedIn.includes(p)).length,
        feeRecipients: {
          ok: o.keys.filter((k) => k.loadedIn.includes(p) && k.feeRecipient.state === "ok").length,
          fixed: o.keys.filter((k) => k.loadedIn.includes(p) && k.feeRecipient.state === "fixed").length,
          failed: 0,
        },
      })),
      unknownValidatorPackages: [],
      keys: { total: o.keys.length, inSync, imported: 0, summary },
      feeRecipients: {
        total: fees.filter((f) => f !== "not-loaded").length,
        ok: fees.filter((f) => f === "ok").length,
        fixed: fees.filter((f) => f === "fixed").length,
        failed: 0,
      },
      fee: o.client
        ? {
            isInSmoothingPool: o.keys.some((k) => k.feeRecipient.rule === "smoothing-pool"),
            isInOptOutCooldown: false,
            smoothingPoolAddress: DEMO.smoothingPool,
            feeDistributorAddress: DEMO.feeDistributor,
            megapoolAddress: DEMO.megapool,
          }
        : null,
      validators: o.keys,
      errors: o.errors ?? [],
    },
  };
}


/* ------------------------------------------------------------------ */
/* Screens: minipool details, rewards, RPL (Task 7)                     */
/* ------------------------------------------------------------------ */

const GAS = { estimated: 145_000, safe: 217_500 };

/** A `can-X` answer with Smartnode's real flag names and a gas estimate. */
export const can = (flags: Record<string, unknown>, gasLimits: { estimated: number; safe: number } = GAS) => ({
  status: "success",
  error: "",
  ...flags,
  gasLimits,
});

function closeDetail(mp: MinipoolDetails, o: { canClose: boolean; beaconState: string; balance?: string; nodeShare?: string; distributed?: boolean }) {
  return {
    address: mp.address,
    isFinalized: false,
    minipoolStatus: mp.status.status,
    minipoolVersion: 3,
    distributed: o.distributed ?? false,
    canClose: o.canClose,
    balance: eth(o.balance ?? "0.0412"),
    refund: 0,
    userDepositBalance: mp.user?.depositBalance ?? 0,
    beaconState: o.beaconState,
    nodeShare: eth(o.nodeShare ?? "0"),
    gasLimits: o.canClose ? { estimated: 182_000, safe: 273_000 } : { estimated: 0, safe: 0 },
  };
}

function distributeDetail(mp: MinipoolDetails, o: { canDistribute: boolean; balance?: string; nodeShare?: string }) {
  return {
    address: mp.address,
    balance: eth(o.balance ?? "0.0412"),
    refund: 0,
    nodeShareOfBalance: eth(o.nodeShare ?? "0.0187"),
    minipoolVersion: 3,
    status: mp.status.status,
    isFinalized: false,
    canDistribute: o.canDistribute,
    gasLimits: o.canDistribute ? { estimated: 121_000, safe: 181_500 } : { estimated: 0, safe: 0 },
  };
}

const closeDetails = (details: ReturnType<typeof closeDetail>[]) => ({
  status: "success",
  error: "",
  expressTicketsProvisioned: true,
  isFeeDistributorInitialized: true,
  details,
});

const pendingRewards = (node: string, refund = "0") => ({
  status: "success",
  error: "",
  rewardSplit: { NodeRewards: eth(node), VoterRewards: eth("0.0011"), ProtocolDAORewards: eth("0.0004"), RethRewards: eth("0.0139") },
  refundValue: eth(refund),
});

/** Reads every node with a wallet answers the same way. */
const walletReads = (o: { feeDistributor?: { balance: string; nodeShare: number }; allowance?: string }) => ({
  // Without it (the minipool node) the mock's generic answer stands: the transaction-flow tests price it.
  ...(o.feeDistributor
    ? { "node/can-distribute": can({ balance: eth(o.feeDistributor.balance), nodeShare: o.feeDistributor.nodeShare }, { estimated: 64_000, safe: 96_000 }) }
    : {}),
  "node/stake-rpl-allowance": { status: "success", error: "", allowance: eth(o.allowance ?? "0") },
  "node/get-stake-rpl-approval-gas": can({}, { estimated: 46_000, safe: 69_000 }),
  "node/can-stake-rpl": can({ canStake: true, insufficientBalance: false, inConsensus: false }),
  "node/can-unstake-rpl": can({ canUnstake: true, insufficientBalance: false, hasDifferentRPLWithdrawalAddress: false }),
  "node/can-unstake-legacy-rpl": can({ canUnstake: true, insufficientBalance: false, hasDifferentRPLWithdrawalAddress: false, belowMaxRPLStake: false }),
  "node/can-withdraw-rpl": can({ canWithdraw: false, insufficientBalance: true, unstakingPeriodActive: false, hasDifferentRPLWithdrawalAddress: false }),
  "node/can-claim-rewards": can({}, { estimated: 212_000, safe: 318_000 }),
  "node/can-claim-and-stake-rewards": can({}, { estimated: 298_000, safe: 447_000 }),
  "node/can-claim-unclaimed-rewards": can({ canClaim: true }),
  "node/can-withdraw-credit": can({ canWithdraw: true, insufficientBalance: false }),
  "node/can-withdraw-eth": can({ canWithdraw: true, insufficientBalance: false, hasDifferentWithdrawalAddress: false }),
  "node/can-provision-express-tickets": can({ canProvision: false, alreadyProvisioned: true }),
  "minipool/can-exit": can({ canExit: true, invalidStatus: false }, { estimated: 0, safe: 0 }),
  "megapool/can-exit-validator": can({ canExit: true, invalidStatus: false }, { estimated: 0, safe: 0 }),
  "megapool/can-exit-queue": can({ canExit: true }, { estimated: 88_000, safe: 132_000 }),
  "megapool/can-claim-refund": can({ canClaim: false }, { estimated: 0, safe: 0 }),
  "megapool/can-repay-debt": can({ canRepay: true, notEnoughDebt: false, notEnoughBalance: false }),
  "megapool/get-new-validator-bond-requirement": { status: "success", error: "", newValidatorBondRequirement: eth("4") },
});

/** `node/get-bond-requirement` answers for the demo nodes: 4 ETH per validator beyond the first two (8 ETH), like Saturn's schedule. */
export const demoBondRequirement = (numValidators: number): string | number => eth(String(numValidators <= 2 ? 4 * numValidators : 8 + 4 * (numValidators - 2)));

/* ------------------------------------------------------------------ */

const minipoolNode: MockScenario = {
  name: "minipool",
  title: "Minipool node",
  avado: baseAvado,
  reconcile: reconcileView({
    state: "ok",
    client: NIMBUS,
    keys: [
      demoKey(DEMO.pubkeyA, "minipool", DEMO.minipoolA, "loaded", "smoothing-pool", DEMO.smoothingPool),
      demoKey(DEMO.pubkeyB, "minipool", DEMO.minipoolB, "loaded", "smoothing-pool", DEMO.smoothingPool),
    ],
  }),
  reads: {
    ...sharedReads,
    "wallet/status": walletStatus(true),
    "node/status": nodeStatus({
      withdrawal: DEMO.coldWallet,
      eth: "0.4128",
      rpl: "12.5",
      legacyRpl: "1450",
      minipools: [MINIPOOL_A, MINIPOOL_B],
      megapool: NO_MEGAPOOL,
      smoothingPool: true,
      unclaimed: "0.0931",
    }),
    "minipool/status": minipoolStatus([MINIPOOL_A, MINIPOOL_B]),
    "megapool/status": megapoolStatus(NO_MEGAPOOL),
    "node/get-rewards-info": rewardsInfo({
      minipools: 2,
      megapool: 0,
      stake: "1450",
      unclaimed: [interval(42, "18.4412", "0.0412"), interval(43, "17.9021", "0.0388")],
    }),
    "node/get-smoothing-pool-registration-status": spStatus(true),
    "node/can-deposit": canDeposit("0.4128", false),
    ...walletReads({}),
    "minipool/get-minipool-close-details-for-node": closeDetails([
      closeDetail(MINIPOOL_A, { canClose: false, beaconState: "active_ongoing" }),
      closeDetail(MINIPOOL_B, { canClose: false, beaconState: "active_ongoing" }),
    ]),
    "minipool/get-distribute-balance-details": {
      status: "success",
      error: "",
      details: [distributeDetail(MINIPOOL_A, { canDistribute: true }), distributeDetail(MINIPOOL_B, { canDistribute: true, balance: "0.0381", nodeShare: "0.0214" })],
    },
    "megapool/can-distribute": can({ canDistribute: false, megapoolNotDeployed: true, lastDistributionTime: 0, lockedValidatorCount: 0, exitingValidatorCount: 0 }, { estimated: 0, safe: 0 }),
    "node/can-provision-express-tickets": can({ canProvision: false, alreadyProvisioned: true }),
  },
  logLines: NORMAL_LOG,
};

const mixedNode: MockScenario = {
  name: "mixed",
  title: "Minipool + megapool node",
  avado: { ...baseAvado, legacyMnemonicPresent: true },
  reconcile: reconcileView({
    state: "attention",
    client: TEKU,
    keys: [
      demoKey(DEMO.pubkeyC, "minipool", DEMO.minipoolC, "loaded", "fee-distributor", DEMO.feeDistributor, "fixed", [TEKU.package]),
      demoKey(DEMO.megaPubkey1, "megapool", "0", "loaded", "megapool", DEMO.megapool, "ok", [TEKU.package]),
      demoKey(DEMO.megaPubkey2, "megapool", "1", "awaiting-approval", "megapool", DEMO.megapool),
    ],
  }),
  reads: {
    ...sharedReads,
    "wallet/status": walletStatus(true),
    "node/status": nodeStatus({
      withdrawal: DEMO.nodeAddress,
      eth: "0.0061",
      rpl: "0",
      legacyRpl: "610",
      minipools: [MINIPOOL_C],
      megapool: MEGAPOOL,
      smoothingPool: false,
      unclaimed: "0.0214",
    }),
    "minipool/status": minipoolStatus([MINIPOOL_C]),
    "megapool/status": megapoolStatus(MEGAPOOL),
    "node/get-rewards-info": rewardsInfo({ minipools: 1, megapool: 1, stake: "610", unclaimed: [interval(43, "6.1204", "0")] }),
    "node/get-smoothing-pool-registration-status": spStatus(false),
    ...walletReads({ feeDistributor: { balance: "0.0931", nodeShare: 0.0412 } }),
    "minipool/get-minipool-close-details-for-node": closeDetails([closeDetail(MINIPOOL_C, { canClose: false, beaconState: "active_ongoing" })]),
    "minipool/get-distribute-balance-details": { status: "success", error: "", details: [distributeDetail(MINIPOOL_C, { canDistribute: true, balance: "0.0295", nodeShare: "0.0133" })] },
    "megapool/can-distribute": can({ canDistribute: true, megapoolNotDeployed: false, lastDistributionTime: 1_755_000_000, lockedValidatorCount: 0, exitingValidatorCount: 0 }, { estimated: 98_000, safe: 147_000 }),
    "megapool/pending-rewards": pendingRewards("0.0214"),
    // 0.0061 ETH in the wallet: not enough for a bond.
    "node/can-deposit": canDeposit("0.0061", false),
  },
  logLines: [
    ...NORMAL_LOG,
    "2026/09/23 09:59:11 Megapool validator 1 is in the deposit queue at position 214.",
  ],
};

const NO_WALLET = "The node wallet has not been initialized. Please run 'rocketpool wallet init' and try again.";

const freshNode: MockScenario = {
  name: "fresh",
  title: "New node (no wallet)",
  avado: { ...baseAvado, backups: [], walletFilePresent: false, passwordFilePresent: false },
  reconcile: reconcileView({ state: "waiting", client: null, keys: [], message: "No Rocket Pool wallet yet." }),
  reads: {
    ...sharedReads,
    "wallet/status": walletStatus(false),
    "node/status": new DemoSnError(500, NO_WALLET),
    "minipool/status": new DemoSnError(500, NO_WALLET),
    "megapool/status": new DemoSnError(500, NO_WALLET),
    "node/get-rewards-info": new DemoSnError(500, NO_WALLET),
    "node/get-smoothing-pool-registration-status": new DemoSnError(500, NO_WALLET),
  },
  logLines: ["2026/09/23 09:40:00 Waiting for the node wallet to be initialized..."],
};

const NOT_REGISTERED = "The node is not registered with Rocket Pool.";

/** A node with nothing on it yet: no minipools, no megapool, no express tickets. */
const EMPTY_MEGAPOOL: MegapoolDetails = { ...NO_MEGAPOOL, nodeExpressTicketCount: 0 };

const unregisteredNode: MockScenario = {
  name: "unregistered",
  title: "Wallet ready, not registered",
  avado: { ...baseAvado, backups: [] },
  reconcile: reconcileView({ state: "waiting", client: null, keys: [], message: "The node is not registered with Rocket Pool yet." }),
  reads: {
    ...sharedReads,
    "wallet/status": walletStatus(true),
    "node/status": nodeStatus({
      withdrawal: DEMO.nodeAddress,
      eth: "8.2",
      rpl: "0",
      legacyRpl: "0",
      minipools: [],
      megapool: EMPTY_MEGAPOOL,
      smoothingPool: false,
      unclaimed: "0",
      registered: false,
    }),
    "minipool/status": minipoolStatus([]),
    "megapool/status": megapoolStatus(EMPTY_MEGAPOOL),
    "node/get-rewards-info": new DemoSnError(500, NOT_REGISTERED),
    "node/get-smoothing-pool-registration-status": new DemoSnError(500, NOT_REGISTERED),
    "node/can-register": { status: "success", error: "", canRegister: true, alreadyRegistered: false, registrationDisabled: false, gasLimits: { estimated: 290_000, safe: 435_000 } },
  },
  logLines: ["2026/09/23 09:40:00 The node is not registered with Rocket Pool yet."],
};

const newNode: MockScenario = {
  name: "new-node",
  title: "Registered, no validators yet",
  avado: { ...baseAvado, backups: [] },
  reconcile: reconcileView({ state: "ok", client: NIMBUS, keys: [], message: "No Rocket Pool validators yet." }),
  reads: {
    ...sharedReads,
    "wallet/status": walletStatus(true),
    "node/status": nodeStatus({
      withdrawal: DEMO.nodeAddress,
      pendingWithdrawal: DEMO.coldWallet,
      eth: "8.35",
      rpl: "0",
      legacyRpl: "0",
      minipools: [],
      megapool: EMPTY_MEGAPOOL,
      smoothingPool: false,
      unclaimed: "0",
    }),
    "minipool/status": minipoolStatus([]),
    "megapool/status": megapoolStatus(EMPTY_MEGAPOOL),
    "node/get-rewards-info": rewardsInfo({ minipools: 0, megapool: 0, stake: "0", unclaimed: [] }),
    "node/get-smoothing-pool-registration-status": spStatus(false),
    "node/can-deposit": canDeposit("8.35", true),
  },
  logLines: NORMAL_LOG,
};

/** Teku too old for safe key loading (backend TEKU_SAFE_IMPORT_VERSION 0.0.76). */
const OLD_TEKU_REASON = "Teku 0.0.75 is too old to load keys into safely. Update Teku before loading keys.";

function keysAttentionReconcile(): ReconcileView {
  const view = reconcileView({
    state: "error",
    client: TEKU,
    keys: [
      demoKey(DEMO.pubkeyA, "minipool", DEMO.minipoolA, "loaded", "fee-distributor", DEMO.feeDistributor, "ok", [TEKU.package]),
      demoKey(DEMO.pubkeyB, "minipool", DEMO.minipoolB, "loaded-twice", "fee-distributor", DEMO.feeDistributor, "ok", [NIMBUS.package, TEKU.package]),
      demoKey(DEMO.megaPubkey1, "megapool", "0", "awaiting-approval", "megapool", DEMO.megapool),
      demoKey(DEMO.megaPubkey2, "megapool", "1", "awaiting-approval", "megapool", DEMO.megapool),
      demoKey(DEMO.megaPubkey3, "megapool", "2", "settling", "megapool", DEMO.megapool),
      demoKey(DEMO.megaPubkey4, "megapool", "3", "client-update-needed", "megapool", DEMO.megapool),
    ],
    message: `Validator 0x${DEMO.pubkeyB} is loaded in both Nimbus and Teku — this can get it slashed. Remove it from one of them now.`,
    importBlockedReasons: [OLD_TEKU_REASON],
  });
  const status = view.status as { clients: Array<{ package: string; version: string }> };
  for (const c of status.clients) if (c.package === TEKU.package) c.version = "0.0.75";
  return view;
}

const KEYS_MEGAPOOL: MegapoolDetails = {
  ...MEGAPOOL,
  validatorCount: 4,
  activeValidatorCount: 4,
  nodeBond: eth("16"),
  nodeQueuedBond: 0,
  validators: [
    megaValidator(0, DEMO.megaPubkey1, "active"),
    megaValidator(1, DEMO.megaPubkey2, "active"),
    megaValidator(2, DEMO.megaPubkey3, "active"),
    megaValidator(3, DEMO.megaPubkey4, "active"),
  ],
};

const keysAttentionNode: MockScenario = {
  name: "keys-attention",
  title: "Validator keys need attention",
  avado: baseAvado,
  reconcile: keysAttentionReconcile(),
  reads: {
    ...sharedReads,
    "wallet/status": walletStatus(true),
    "node/status": nodeStatus({
      withdrawal: DEMO.coldWallet,
      eth: "0.35",
      rpl: "0",
      legacyRpl: "900",
      minipools: [MINIPOOL_A, MINIPOOL_B],
      megapool: KEYS_MEGAPOOL,
      smoothingPool: true,
      unclaimed: "0.05",
    }),
    "minipool/status": minipoolStatus([MINIPOOL_A, MINIPOOL_B]),
    "megapool/status": megapoolStatus(KEYS_MEGAPOOL),
    "node/get-rewards-info": rewardsInfo({ minipools: 2, megapool: 4, stake: "900", unclaimed: [] }),
    "node/get-smoothing-pool-registration-status": spStatus(true),
  },
  logLines: NORMAL_LOG,
};

const daemonFailed: MockScenario = {
  name: "daemon-failed",
  title: "Daemon failed to start",
  avado: {
    ...baseAvado,
    daemon: { state: "FATAL", description: "Exited too quickly (process log may have details)", exitStatus: 1 },
    apiReachable: false,
    startupError:
      "Rocket Pool could not load its settings: the execution client URL http://ethchain-geth.my.ava.do:8545 does not answer.",
    daemonErrors: [
      "2026/09/23 09:31:02 error loading config: execution client not reachable",
      "2026/09/23 09:31:05 error loading config: execution client not reachable",
    ],
  },
  reconcile: reconcileView({
    state: "waiting",
    client: null,
    keys: [],
    message: "Waiting for the Rocket Pool daemon.",
    errors: ["The Rocket Pool daemon is not reachable (it may still be starting)."],
  }),
  reads: {},
  daemonDown: true,
  logLines: [
    "2026/09/23 09:31:02 error loading config: execution client not reachable",
    "2026/09/23 09:31:05 error loading config: execution client not reachable",
  ],
};

/* An operator winding down: exits, closing, debt, refund, credit and unstaking RPL. */

const MINIPOOL_D: MinipoolDetails = {
  ...minipool(DEMO.minipoolD, DEMO.pubkeyD, { index: "401122", bond: "8", fee: 0.14, balance: "0", nodeShare: "0" }),
  balances: { eth: eth("32.0514"), reth: 0, rpl: 0, fixedSupplyRpl: 0 },
  nodeShareOfETHBalance: eth("8.0311"),
  validator: { exists: true, active: false, index: "401122", balance: 0, nodeBalance: 0 },
  closeAvailable: true,
};
const MINIPOOL_E = minipool(DEMO.minipoolE, DEMO.pubkeyE, { index: "401123", bond: "16", fee: 0.15, balance: "32.0122", nodeShare: "16.0061" });

const WINDING_MEGAPOOL: MegapoolDetails = {
  ...MEGAPOOL,
  // An older contract version, not set to follow the latest: "Update megapool contract" shows.
  delegate: DEMO.oldDelegate,
  effectiveDelegateAddress: DEMO.oldDelegate,
  useLatestDelegate: false,
  validatorCount: 4,
  activeValidatorCount: 3,
  exitingValidatorCount: 1,
  lockedValidatorCount: 1,
  nodeDebt: eth("0.05"),
  refundValue: eth("0.3"),
  pendingRewards: eth("0.0118"),
  nodeExpressTicketCount: 0,
  nodeBond: eth("12"),
  nodeQueuedBond: eth("4"),
  validators: [
    megaValidator(0, DEMO.megaPubkey1, "active"),
    megaValidator(1, DEMO.megaPubkey3, "exiting"),
    megaValidator(2, DEMO.megaPubkey4, "locked"),
    megaValidator(3, DEMO.megaPubkey5, "queued"),
  ],
};

const exitsNode: MockScenario = {
  name: "exits",
  title: "Exits and closing",
  avado: {
    ...baseAvado,
    backups: [
      { name: "1.0.0-20260921T090000Z", createdAt: "2026-09-21T09:00:00Z", kind: "upgrade" },
      { name: "20260920T120000Z-before-wallet-change", createdAt: "2026-09-20T12:00:00Z", kind: "wallet-change" },
      { name: "legacy-20260919T081100Z", createdAt: "2026-09-19T08:11:00Z", kind: "upgrade" },
    ],
    settings: { autoTxGasThreshold: "20", distributeThreshold: "1", manualMaxFee: "0", priorityFee: "0.01" },
  },
  reconcile: reconcileView({
    state: "ok",
    client: NIMBUS,
    keys: [
      demoKey(DEMO.pubkeyE, "minipool", DEMO.minipoolE, "loaded", "fee-distributor", DEMO.feeDistributor),
      demoKey(DEMO.megaPubkey1, "megapool", "0", "loaded", "megapool", DEMO.megapool),
      demoKey(DEMO.megaPubkey3, "megapool", "1", "loaded", "megapool", DEMO.megapool),
    ],
  }),
  reads: {
    ...sharedReads,
    "wallet/status": walletStatus(true),
    "node/status": nodeStatus({
      withdrawal: DEMO.coldWallet,
      eth: "1.2",
      rpl: "150",
      legacyRpl: "900",
      minipools: [MINIPOOL_D, MINIPOOL_E],
      megapool: WINDING_MEGAPOOL,
      smoothingPool: false,
      unclaimed: "0",
      extra: {
        rplStakeMegapool: eth("200"),
        totalRplStake: eth("1100"),
        rplStakeThreshold: eth("412.5"),
        unstakingRPL: eth("300"),
        lastRPLUnstakeTime: "2026-08-20T10:00:00Z",
        megapoolNodeDebt: eth("0.05"),
        megapoolRefundValue: eth("0.3"),
        creditBalance: eth("4"),
        expressTicketCount: 0,
        expressTicketsProvisioned: false,
        minipoolCounts: { ...counts(2), closeAvailable: 1 },
      },
    }),
    "minipool/status": minipoolStatus([MINIPOOL_D, MINIPOOL_E]),
    "megapool/status": megapoolStatus(WINDING_MEGAPOOL),
    "node/get-rewards-info": rewardsInfo({ minipools: 1, megapool: 3, stake: "1100", unclaimed: [interval(43, "9.8811", "0.0144")] }),
    "node/get-smoothing-pool-registration-status": spStatus(false),
    ...walletReads({ feeDistributor: { balance: "0.0474", nodeShare: 0.0208 } }),
    "minipool/get-minipool-close-details-for-node": closeDetails([
      closeDetail(MINIPOOL_D, { canClose: true, beaconState: "withdrawal_done", balance: "32.0514", nodeShare: "8.0311" }),
      closeDetail(MINIPOOL_E, { canClose: false, beaconState: "active_ongoing" }),
    ]),
    "minipool/get-distribute-balance-details": {
      status: "success",
      error: "",
      details: [distributeDetail(MINIPOOL_D, { canDistribute: false, balance: "32.0514", nodeShare: "8.0311" }), distributeDetail(MINIPOOL_E, { canDistribute: false, balance: "0.0081", nodeShare: "0.0037" })],
    },
    "megapool/can-distribute": can({ canDistribute: false, megapoolNotDeployed: false, lastDistributionTime: 1_755_000_000, lockedValidatorCount: 1, exitingValidatorCount: 1 }, { estimated: 0, safe: 0 }),
    "megapool/pending-rewards": pendingRewards("0.0118", "0.3"),
    "megapool/can-claim-refund": can({ canClaim: true }, { estimated: 71_000, safe: 106_500 }),
    "node/can-withdraw-rpl": can({ canWithdraw: true, insufficientBalance: false, unstakingPeriodActive: false, hasDifferentRPLWithdrawalAddress: false }),
    "node/can-unstake-legacy-rpl": can({ canUnstake: true, insufficientBalance: false, hasDifferentRPLWithdrawalAddress: false, belowMaxRPLStake: true }),
    "node/can-provision-express-tickets": can({ canProvision: true, alreadyProvisioned: false }),
    "node/can-deposit": can({ canDeposit: false, nodeHasDebt: true, canUseCredit: true, creditBalance: eth("4"), usableCreditBalance: eth("4"), nodeBalance: eth("1.2"), insufficientBalance: false, insufficientBalanceWithoutCredit: false, invalidAmount: false, depositDisabled: false, inConsensus: false }, { estimated: 0, safe: 0 }),
  },
  logLines: [
    ...NORMAL_LOG,
    "2026/09/23 09:57:12 Megapool validator 1 is exiting (withdrawable epoch 413056).",
    "2026/09/23 09:57:13 Gas price 0.85 gwei is below the automatic transaction threshold (20 gwei).",
  ],
};

export const SCENARIOS: Record<MockScenarioName, MockScenario> = {
  minipool: minipoolNode,
  mixed: mixedNode,
  fresh: freshNode,
  unregistered: unregisteredNode,
  "new-node": newNode,
  "keys-attention": keysAttentionNode,
  "daemon-failed": daemonFailed,
  exits: exitsNode,
};

export const isScenarioName = (v: unknown): v is MockScenarioName =>
  typeof v === "string" && (MOCK_SCENARIOS as readonly string[]).includes(v);
