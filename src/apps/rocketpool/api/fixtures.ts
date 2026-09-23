/**
 * Demo data for `VITE_MOCK=1` and tests: four nodes, shaped like the real
 * answers of the package backend and Smartnode v1.24.2.
 *
 *  - `minipool`: an existing operator with two minipools (the typical AVADO
 *    node today), in the smoothing pool, cold withdrawal address.
 *  - `mixed`: one minipool plus a megapool with two validators (one active,
 *    one in the queue), not in the smoothing pool, withdrawal address still
 *    the hot wallet, little ETH left for gas.
 *  - `fresh`: a new install: daemon running, no wallet yet.
 *  - `daemon-failed`: the daemon would not start (bad settings); its API is down.
 *
 * Big integers follow the wire format: a number when it is a safe integer,
 * else a string with the exact digits.
 */
import type {
  AvadoStatus,
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

export type MockScenarioName = "minipool" | "mixed" | "fresh" | "daemon-failed";

export const MOCK_SCENARIOS: readonly MockScenarioName[] = ["minipool", "mixed", "fresh", "daemon-failed"];

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
  pubkeyA: pubkey(1),
  pubkeyB: pubkey(2),
  pubkeyC: pubkey(3),
  megaPubkey1: pubkey(4),
  megaPubkey2: pubkey(5),
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

function megaValidator(id: number, key: string, state: "active" | "queued"): MegapoolValidator {
  const active = state === "active";
  return {
    validatorId: id,
    pubKey: key,
    staked: active,
    exited: false,
    inQueue: !active,
    queuePosition: active ? 0 : 214,
    inPrestake: false,
    expressUsed: active,
    dissolved: false,
    exiting: false,
    locked: false,
    validatorIndex: active ? 2_104_551 : 0,
    exitBalance: 0,
    withdrawableEpoch: 0,
    activated: active,
    beaconStatus: active ? beacon(key, "2104551", "active_ongoing", 32_004_812_331, 401_220) : beacon(key, "", "", 0, 0),
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
}): NodeStatus {
  const hasMegapool = o.megapool.deployed && o.megapool.validatorCount > 0;
  return {
    status: "success",
    error: "",
    warning: "",
    accountAddress: DEMO.nodeAddress,
    primaryWithdrawalAddress: o.withdrawal,
    pendingPrimaryWithdrawalAddress: ZERO_ADDRESS,
    isRPLWithdrawalAddressSet: false,
    rplWithdrawalAddress: o.withdrawal,
    pendingRPLWithdrawalAddress: ZERO_ADDRESS,
    registered: true,
    trusted: false,
    timezoneLocation: "Europe/Ljubljana",
    accountBalances: { eth: eth(o.eth), reth: 0, rpl: eth(o.rpl), fixedSupplyRpl: 0 },
    totalRplStake: eth(o.legacyRpl),
    rplStakeMegapool: 0,
    rplStakeLegacy: eth(o.legacyRpl),
    rplStakeThreshold: eth("310.5"),
    unstakingRPL: 0,
    lastRPLUnstakeTime: "0001-01-01T00:00:00Z",
    unstakingPeriodDuration: 2_419_200_000_000_000, // 28 days in ns
    minipoolCounts: counts(o.minipools.length),
    isFeeDistributorInitialized: true,
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
  };
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

export const SCENARIOS: Record<MockScenarioName, MockScenario> = {
  minipool: minipoolNode,
  mixed: mixedNode,
  fresh: freshNode,
  "daemon-failed": daemonFailed,
};

export const isScenarioName = (v: unknown): v is MockScenarioName =>
  typeof v === "string" && (MOCK_SCENARIOS as readonly string[]).includes(v);
