/**
 * Demo nodes for `VITE_MOCK=1 yarn dev:qtum` (`?scenario=<name>`) and the
 * tests. Each scenario is what the monitor and the node would answer.
 */
import type { QtumSettings, StakingSummary, WalletStatus } from "./models";

export const MOCK_SCENARIOS = [
  "fresh",
  "syncing",
  "staking",
  "locked",
  "upgrade-failed",
  "needs-password",
  "rebuilding",
  "rebuilt",
  "restoring",
  "backup-required",
] as const;

export type MockScenarioName = (typeof MOCK_SCENARIOS)[number];

export const isScenarioName = (v: unknown): v is MockScenarioName => typeof v === "string" && (MOCK_SCENARIOS as readonly string[]).includes(v);

export const DEFAULT_SCENARIO: MockScenarioName = "staking";

/** The node's state in a scenario. */
export interface DemoNode {
  /** The node's RPC is warming up (-28) or not there (502). */
  rpc: "up" | "warmup" | "down";
  blocks: number;
  headers: number;
  progress: number;
  ibd: boolean;
  peers: number;
  subversion: string;
  stakingEnabled: boolean;
  weight: number;
  expectedtime: number;
}

export interface DemoWallet {
  trusted: number;
  pending: number;
  stake: number;
  immature: number;
  /** null: no password. A number: unlocked until (0 = locked). */
  unlockedUntil: number | null;
  /** The wallet's password in the demo. */
  password: string;
  /** label → addresses */
  labels: Record<string, string[]>;
}

export interface MockScenario {
  name: MockScenarioName;
  walletStatus: WalletStatus;
  settings: QtumSettings;
  node: DemoNode;
  wallet: DemoWallet;
  summary: StakingSummary;
  logs: string[];
}

export const DEMO_PASSWORD = "demo password";
export const DEMO_ADDRESSES = {
  main: "QgHkG8Ffz6wfBDoQXQdEYvJbkmCkcyzMnb",
  savings: "QNaGRrKYxjbx9DbRn1vh2XNCBvq2JKxYwq",
  new: ["QXq1D2pVzpBf3DjK3hJk4yM6YQzEFtbGn7", "QUbH2vVtFDzr7LzT4W5XgeFqJdJ7bFQq9B", "QfZ8m4W3oYyX1kE6tuS1vYcXpMWcYb2xQH"],
};
export const DEMO_WIF = "L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ";

const NOW = Date.parse("2026-10-13T10:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

const readyStatus = (over: Partial<WalletStatus> = {}): WalletStatus => ({
  state: "ready",
  message: "",
  problem: null,
  busy: null,
  migration: null,
  rebuild: null,
  newBackupRequired: false,
  import: null,
  restore: null,
  scanning: false,
  ...over,
});

const settings = (over: Partial<QtumSettings> = {}): QtumSettings => ({
  DELEGATION_FEE_PERCENT: 10,
  MIN_DELEGATION_AMOUNT: 100,
  BACKUP_REQUIRED: false,
  ...over,
});

const syncedNode = (over: Partial<DemoNode> = {}): DemoNode => ({
  rpc: "up",
  blocks: 4_812_377,
  headers: 4_812_377,
  progress: 0.99999987,
  ibd: false,
  peers: 12,
  subversion: "/Qtum:30.2.0/",
  stakingEnabled: true,
  weight: 249_800_000_000,
  expectedtime: 3 * 86400 + 4 * 3600,
  ...over,
});

const stakingWallet = (over: Partial<DemoWallet> = {}): DemoWallet => ({
  trusted: 2_498.1234,
  pending: 0,
  stake: 0.4,
  immature: 0,
  unlockedUntil: null,
  password: DEMO_PASSWORD,
  labels: { "": [DEMO_ADDRESSES.main], savings: [DEMO_ADDRESSES.savings] },
  ...over,
});

const emptyWallet = (): DemoWallet => ({ trusted: 0, pending: 0, stake: 0, immature: 0, unlockedUntil: null, password: DEMO_PASSWORD, labels: {} });

const summary = (over: Partial<StakingSummary> = {}): StakingSummary => ({
  totalRewards: 18.40001234,
  rewards30d: 1.6,
  count: 4,
  countAll: 46,
  lastRewardAt: hoursAgo(20),
  computedAt: new Date(NOW).toISOString(),
  truncated: false,
  ...over,
});

const noRewards = () => summary({ totalRewards: 0, rewards30d: 0, count: 0, countAll: 0, lastRewardAt: null });

const LOGS = [
  "2026-10-13T09:58:01Z UpdateTip: new best=[key] height=4812376 version=0x20000000 log2_work=96.2 tx=12409811 date='2026-10-13T09:58:00Z' progress=1.000000 cache=4.1MiB(28911txo)",
  "2026-10-13T09:58:33Z UpdateTip: new best=[key] height=4812377 version=0x20000000 log2_work=96.2 tx=12409813 date='2026-10-13T09:58:32Z' progress=1.000000 cache=4.1MiB(28915txo)",
  "2026-10-13T09:59:10Z Staker: searching for a stake (weight 2498 QTUM)",
  "2026-10-13T09:59:40Z New outbound-full-relay v1 peer connected: version: 70017, blocks=4812377, peer=118",
];

const failedUpgrade: WalletStatus = readyStatus({
  state: "failed",
  message: "migratewallet: Error: Unable to read the wallet file (the database is corrupted)",
  migration: {
    state: "failed",
    method: "upgrade",
    migratedAt: null,
    failedAt: hoursAgo(2),
    error: "Unable to read the wallet file (the database is corrupted)",
    encrypted: false,
    canRebuild: true,
  },
});

export const SCENARIOS: Record<MockScenarioName, () => MockScenario> = {
  fresh: () => ({
    name: "fresh",
    walletStatus: readyStatus({ state: "starting" }),
    settings: settings({ BACKUP_REQUIRED: true }),
    node: syncedNode({ rpc: "warmup", blocks: 0, headers: 0, progress: 0, ibd: true, peers: 0, weight: 0, expectedtime: 0 }),
    wallet: emptyWallet(),
    summary: noRewards(),
    logs: ["2026-10-13T09:59:58Z Loading block index…", "2026-10-13T09:59:59Z Verifying blocks…"],
  }),
  syncing: () => ({
    name: "syncing",
    walletStatus: readyStatus(),
    settings: settings(),
    node: syncedNode({ blocks: 2_310_552, headers: 4_812_377, progress: 0.4718, ibd: true, peers: 8, weight: 0, expectedtime: 0 }),
    wallet: stakingWallet({ stake: 0 }),
    summary: summary({ rewards30d: 0, count: 0, lastRewardAt: hoursAgo(24 * 61) }),
    logs: LOGS,
  }),
  staking: () => ({
    name: "staking",
    walletStatus: readyStatus(),
    settings: settings(),
    node: syncedNode(),
    wallet: stakingWallet(),
    summary: summary(),
    logs: LOGS,
  }),
  locked: () => ({
    name: "locked",
    walletStatus: readyStatus({
      migration: { state: "done", method: "upgrade", migratedAt: hoursAgo(48), failedAt: null, error: null, encrypted: true, canRebuild: false },
    }),
    settings: settings(),
    node: syncedNode({ weight: 0, expectedtime: 0 }),
    wallet: stakingWallet({ unlockedUntil: 0, stake: 0 }),
    summary: summary({ rewards30d: 0, count: 0, lastRewardAt: hoursAgo(24 * 9) }),
    logs: LOGS,
  }),
  "upgrade-failed": () => ({
    name: "upgrade-failed",
    walletStatus: failedUpgrade,
    settings: settings(),
    node: syncedNode({ weight: 0, expectedtime: 0 }),
    wallet: emptyWallet(),
    summary: noRewards(),
    logs: LOGS,
  }),
  "needs-password": () => ({
    name: "needs-password",
    walletStatus: readyStatus({
      state: "needs-passphrase",
      message: "The wallet has a password",
      migration: { state: "needs-passphrase", method: "upgrade", migratedAt: null, failedAt: null, error: null, encrypted: true, canRebuild: true },
    }),
    settings: settings(),
    node: syncedNode({ weight: 0, expectedtime: 0 }),
    wallet: emptyWallet(),
    summary: noRewards(),
    logs: LOGS,
  }),
  rebuilding: () => ({
    name: "rebuilding",
    walletStatus: readyStatus({
      state: "rebuilding",
      message: "Scanning the blockchain for your coins: 42 %",
      busy: "rebuilding",
      migration: { ...failedUpgrade.migration!, state: "failed" },
      rebuild: { state: "running", step: "Scanning the blockchain for your coins", progress: 42, error: null, notCarriedOver: "", source: null, seedRestored: false },
    }),
    settings: settings(),
    node: syncedNode({ weight: 0, expectedtime: 0 }),
    wallet: emptyWallet(),
    summary: noRewards(),
    logs: LOGS,
  }),
  rebuilt: () => ({
    name: "rebuilt",
    walletStatus: readyStatus({
      newBackupRequired: true,
      migration: { state: "done", method: "rebuild", migratedAt: hoursAgo(1), failedAt: hoursAgo(5), error: null, encrypted: false, canRebuild: false },
      rebuild: {
        state: "done",
        step: null,
        progress: null,
        error: null,
        notCarriedOver: "Not carried over to the new wallet: 2 tokens. The old wallet still has them.",
        source: "raw-pages",
        seedRestored: false,
      },
    }),
    settings: settings(),
    node: syncedNode(),
    wallet: stakingWallet(),
    summary: summary(),
    logs: LOGS,
  }),
  restoring: () => ({
    name: "restoring",
    walletStatus: readyStatus({ state: "restoring", busy: "restoring" }),
    settings: settings(),
    node: syncedNode({ rpc: "down" }),
    wallet: stakingWallet(),
    summary: summary(),
    logs: LOGS,
  }),
  "backup-required": () => ({
    name: "backup-required",
    walletStatus: readyStatus(),
    settings: settings({ BACKUP_REQUIRED: true }),
    node: syncedNode({ weight: 0, expectedtime: 0 }),
    wallet: emptyWallet(),
    summary: noRewards(),
    logs: LOGS,
  }),
};
