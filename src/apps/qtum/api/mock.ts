/**
 * In-memory Qtum package for `VITE_MOCK=1` and the tests, on the scenarios
 * in `fixtures.ts`. It answers like the monitor and the node: the same
 * fields, the same refusals (400 with the monitor's own words, RPC error
 * codes such as -14 for a wrong password, -28 while the node starts).
 *
 * Mock conventions:
 *  - The demo wallet's password is `DEMO_PASSWORD` ("demo password").
 *  - Actions that start a wallet task (restart, retry the upgrade, rebuild,
 *    restore, import a key) switch the status at once; with `settleMs` they
 *    finish by themselves after that long (the dev server uses 4 s; tests
 *    leave it unset and see the running state).
 *  - Unlocking a locked wallet with coins starts staking.
 */
import { QtumApiError } from "./errors";
import { DEFAULT_SCENARIO, DEMO_ADDRESSES, DEMO_WIF, SCENARIOS, isScenarioName, type DemoNode, type DemoWallet, type MockScenario, type MockScenarioName } from "./fixtures";
import type { BackupDownload, QtumSettings, SettingsPatch, StakingSummary, WalletStatus } from "./models";
import { backupFileName } from "./real";
import type { QtumApi } from "./types";

export interface QtumMockOptions {
  /** Which demo node (default "staking"). */
  scenario?: MockScenarioName;
  /** Simulated latency per call (ms). */
  latencyMs?: number;
  /** Wallet tasks finish by themselves after this long (ms); unset: they keep running. */
  settleMs?: number;
  /** The package is down: every call fails as unreachable. */
  backendDown?: boolean;
  /** Change the scenario's starting state. */
  walletStatus?: Partial<WalletStatus>;
  settings?: Partial<QtumSettings>;
  node?: Partial<DemoNode>;
  wallet?: Partial<DemoWallet>;
  summary?: Partial<StakingSummary>;
  /** Per monitor route (`/backup`) or RPC method (`rpc getnewaddress`): fail with this status and message. */
  failures?: Record<string, { status: number; detail?: string }>;
}

export interface MockCall {
  kind: "GET" | "POST" | "rpc";
  path: string;
  params?: unknown;
}

export interface MockQtumApi extends QtumApi {
  /** Every call made, in order (for tests). */
  readonly calls: MockCall[];
  /** The demo state now (tests may change it). */
  readonly state: MockScenario;
}

/** The demo backup file: the start of an SQLite wallet. */
export const DEMO_BACKUP = new Uint8Array([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00]);

const WALLET_NOT_LOADED = "Your wallet is not loaded yet. Please wait a moment and try again.";
const BUSY = "Your Qtum wallet is busy right now. Please try again in a few minutes.";
const WIF = /^[5KLc9][1-9A-HJ-NP-Za-km-z]{50,51}$/;

/** `?scenario=` from the address, else VITE_MOCK_SCENARIO, else "staking". */
export function scenarioFromEnvironment(search?: string): MockScenarioName {
  let fromUrl: string | null = null;
  try {
    fromUrl = new URLSearchParams(search ?? window.location.search).get("scenario");
  } catch {
    /* no window */
  }
  if (isScenarioName(fromUrl)) return fromUrl;
  const fromEnv: unknown = import.meta.env.VITE_MOCK_SCENARIO;
  return isScenarioName(fromEnv) ? fromEnv : DEFAULT_SCENARIO;
}

export function createMockQtumApi(options: QtumMockOptions = {}): MockQtumApi {
  const { latencyMs = 0, settleMs, backendDown = false, failures = {} } = options;
  const base = SCENARIOS[options.scenario ?? DEFAULT_SCENARIO]();
  const state: MockScenario = {
    ...base,
    walletStatus: { ...base.walletStatus, ...options.walletStatus },
    settings: { ...base.settings, ...options.settings },
    node: { ...base.node, ...options.node },
    wallet: { ...base.wallet, labels: { ...base.wallet.labels }, ...options.wallet },
    summary: { ...base.summary, ...options.summary },
  };
  const calls: MockCall[] = [];
  let nextAddress = 0;

  const later = (fn: () => void) => {
    if (settleMs !== undefined) setTimeout(fn, settleMs);
  };
  const setStatus = (over: Partial<WalletStatus>) => {
    state.walletStatus = { ...state.walletStatus, ...over };
  };

  async function enter(kind: MockCall["kind"], path: string, params?: unknown) {
    calls.push({ kind, path, params });
    if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
    if (backendDown) throw new QtumApiError({ kind: "unreachable", path: kind === "rpc" ? `rpc ${path}` : `/monitor${path}` });
    const failure = failures[kind === "rpc" ? `rpc ${path}` : path];
    if (failure) {
      throw new QtumApiError({ kind: "http", path: kind === "rpc" ? `rpc ${path}` : `/monitor${path}`, status: failure.status, detail: failure.detail });
    }
  }
  const refuse = (path: string, status: number, detail: string): never => {
    throw new QtumApiError({ kind: "http", path: `/monitor${path}`, status, detail });
  };
  const rpcError = (method: string, code: number, detail: string, status = 500): never => {
    throw new QtumApiError({ kind: "rpc", path: `rpc ${method}`, status, code, detail });
  };
  const walletReady = () => state.walletStatus.state === "ready";
  const encrypted = () => state.wallet.unlockedUntil !== null;
  const unlocked = () => !encrypted() || (state.wallet.unlockedUntil ?? 0) > 0;
  const isStaking = () =>
    walletReady() && state.node.stakingEnabled && !state.node.ibd && state.node.blocks >= state.node.headers && state.node.weight > 0 && unlocked();

  function rpcAnswer(method: string, params: unknown[]): unknown {
    const node = state.node;
    if (node.rpc === "warmup") return rpcError(method, -28, "Loading block index…");
    if (node.rpc === "down") throw new QtumApiError({ kind: "http", path: `rpc ${method}`, status: 502 });
    const walletMethod = !["getblockchaininfo", "getnetworkinfo", "getstakinginfo"].includes(method);
    if (walletMethod && !walletReady()) return rpcError(method, -18, "Requested wallet does not exist or is not loaded");
    const w = state.wallet;
    switch (method) {
      case "getblockchaininfo":
        return { chain: "main", blocks: node.blocks, headers: node.headers, verificationprogress: node.progress, initialblockdownload: node.ibd };
      case "getnetworkinfo":
        return { version: 300200, subversion: node.subversion, connections: node.peers };
      case "getbalances":
        return { mine: { trusted: w.trusted, untrusted_pending: w.pending, immature: w.immature, stake: w.stake } };
      case "getwalletinfo":
        return { walletname: "", ...(w.unlockedUntil === null ? {} : { unlocked_until: w.unlockedUntil }), scanning: false };
      case "getstakinginfo": {
        const staking = isStaking();
        return {
          enabled: node.stakingEnabled,
          staking,
          errors: "",
          weight: unlocked() ? node.weight : 0,
          netstakeweight: 1_853_000_000_000_000,
          expectedtime: staking ? node.expectedtime : 0,
        };
      }
      case "listlabels":
        return Object.keys(w.labels);
      case "getaddressesbylabel": {
        const label = String(params[0] ?? "");
        const list = w.labels[label] ?? [];
        if (list.length === 0) return rpcError(method, -11, `No addresses with label ${label}`);
        return Object.fromEntries(list.map((a) => [a, { purpose: "receive" }]));
      }
      case "getnewaddress": {
        const label = String(params[0] ?? "");
        const address = DEMO_ADDRESSES.new[nextAddress % DEMO_ADDRESSES.new.length] + (nextAddress >= DEMO_ADDRESSES.new.length ? String(nextAddress) : "");
        nextAddress += 1;
        w.labels = { ...w.labels, [label]: [...(w.labels[label] ?? []), address] };
        return address;
      }
      case "walletpassphrase": {
        if (w.unlockedUntil === null) return rpcError(method, -15, "Error: running with an unencrypted wallet, but walletpassphrase was called.");
        if (params[0] !== w.password) return rpcError(method, -14, "Error: The wallet passphrase entered was incorrect.");
        w.unlockedUntil = Math.floor(Date.now() / 1000) + Number(params[1] ?? 0);
        if (node.weight === 0 && w.trusted > 0) {
          node.weight = Math.round(w.trusted * 1e8);
          node.expectedtime = 4 * 86400;
        }
        return null;
      }
      case "walletlock":
        if (w.unlockedUntil === null) return rpcError(method, -15, "Error: running with an unencrypted wallet, but walletlock was called.");
        w.unlockedUntil = 0;
        return null;
      default:
        return rpcError(method, -32601, "Method not found", 404);
    }
  }

  const api: MockQtumApi = {
    calls,
    state,

    async rpc<T>(method: string, params: unknown[] = []) {
      await enter("rpc", method, params);
      return rpcAnswer(method, params) as T;
    },

    async walletStatus() {
      await enter("GET", "/walletstatus");
      return JSON.parse(JSON.stringify(state.walletStatus)) as WalletStatus;
    },

    async settings() {
      await enter("GET", "/getenv");
      return { ...state.settings };
    },

    async saveSettings(patch: SettingsPatch) {
      await enter("POST", "/setenv", patch);
      const fee = patch.DELEGATION_FEE_PERCENT;
      if (fee !== undefined && !(Number.isInteger(fee) && fee >= 0 && fee <= 100)) refuse("/setenv", 400, "The delegation fee must be a whole number from 0 to 100.");
      const min = patch.MIN_DELEGATION_AMOUNT;
      if (min !== undefined && !(typeof min === "number" && Number.isFinite(min) && min >= 0)) {
        refuse("/setenv", 400, "The minimum delegation amount must be a number of 0 or more.");
      }
      const changed = (fee !== undefined && fee !== state.settings.DELEGATION_FEE_PERCENT) || (min !== undefined && min !== state.settings.MIN_DELEGATION_AMOUNT);
      state.settings = { ...state.settings, ...patch };
      if (changed) {
        setStatus({ state: "restarting" });
        later(() => setStatus({ state: "ready" }));
      }
      return { ...state.settings };
    },

    async restartNode() {
      await enter("POST", "/restartQtum");
      setStatus({ state: "restarting" });
      later(() => setStatus({ state: "ready" }));
    },

    async backupDone() {
      await enter("POST", "/backupdone");
      state.settings = { ...state.settings, BACKUP_REQUIRED: false };
      setStatus({ newBackupRequired: false });
    },

    async downloadBackup(): Promise<BackupDownload> {
      await enter("POST", "/backup");
      if (!walletReady() || state.node.rpc !== "up") refuse("/backup", 500, WALLET_NOT_LOADED);
      return { blob: new Blob([DEMO_BACKUP], { type: "application/octet-stream" }), fileName: backupFileName(null) };
    },

    async uploadBackup(file: Blob) {
      await enter("POST", "/uploadbackup", { size: file.size });
      if (file.size === 0) refuse("/uploadbackup", 400, "No file was sent. Please choose your wallet backup file again.");
      if (state.walletStatus.busy) refuse("/uploadbackup", 409, BUSY);
      return "wallet-upload.dat";
    },

    async restoreBackup(file: string) {
      await enter("POST", "/restore", { file });
      if (state.walletStatus.busy) refuse("/restore", 409, BUSY);
      setStatus({ state: "restoring", busy: "restoring", restore: null });
      later(() => setStatus({ state: "ready", busy: null }));
    },

    async retryUpgrade(passphrase?: string) {
      await enter("POST", "/migrate", passphrase ? { passphrase } : {});
      const m = state.walletStatus.migration;
      if (!m || !["pending", "failed", "needs-passphrase"].includes(m.state)) refuse("/migrate", 400, "There is no wallet upgrade to retry.");
      const rebuild = state.walletStatus.rebuild;
      setStatus({
        state: "migrating",
        busy: "migrating",
        rebuild: rebuild && ["needs-passphrase", "failed", "interrupted"].includes(rebuild.state) ? { ...rebuild, state: "superseded" } : rebuild,
      });
      later(() => {
        if (m!.encrypted && passphrase !== state.wallet.password) {
          setStatus({ state: "needs-passphrase", busy: null, migration: { ...m!, state: "needs-passphrase" } });
          return;
        }
        setStatus({ state: "ready", busy: null, newBackupRequired: true, migration: { ...m!, state: "done", migratedAt: new Date().toISOString() } });
      });
    },

    async rebuildWallet(passphrase?: string) {
      await enter("POST", "/rebuild", passphrase ? { passphrase } : {});
      const m = state.walletStatus.migration;
      if (!m || !["failed", "needs-passphrase"].includes(m.state) || !m.canRebuild) refuse("/rebuild", 400, "There is no failed wallet upgrade to rebuild from.");
      const rebuild = { state: "running", step: "Reading the keys from the copy of your old wallet", progress: null, error: null, notCarriedOver: "", source: null, seedRestored: false };
      setStatus({ state: "rebuilding", busy: "rebuilding", rebuild });
      later(() =>
        setStatus({
          state: "ready",
          busy: null,
          newBackupRequired: true,
          migration: { ...m!, state: "done", method: "rebuild" },
          rebuild: { ...rebuild, state: "done", step: null },
        }),
      );
    },

    async privateKey(address: string) {
      await enter("POST", "/privkey", { address });
      if (!/^[a-zA-Z0-9]{20,100}$/.test(address.trim())) refuse("/privkey", 400, "This is not a Qtum address.");
      const mine = Object.values(state.wallet.labels).some((list) => list.includes(address.trim()));
      if (!mine) refuse("/privkey", 400, "This address is not part of your wallet.");
      return DEMO_WIF;
    },

    async importKey(privateKey: string) {
      await enter("POST", "/importkey", { privateKey: "(hidden)" });
      if (!WIF.test(privateKey.trim())) refuse("/importkey", 400, "This is not a valid Qtum private key. Please check that you copied all of it.");
      if (state.walletStatus.import?.state === "running") refuse("/importkey", 409, "A private key is being imported already. Please wait until it is finished.");
      if (!walletReady()) {
        refuse("/importkey", 409, "Your wallet is not ready yet, so no key can be imported now. Please try again when the message at the top of this page is gone.");
      }
      setStatus({ import: { state: "running", startedAt: new Date().toISOString() }, scanning: { duration: 3, progress: 0.12 } });
      later(() => setStatus({ import: { state: "done", finishedAt: new Date().toISOString() }, scanning: false }));
    },

    async stakingSummary() {
      await enter("GET", "/staking-summary");
      if (!walletReady() || state.node.rpc !== "up") refuse("/staking-summary", 500, WALLET_NOT_LOADED);
      return { ...state.summary };
    },

    async logs(lines = 200) {
      await enter("GET", "/logs", { lines });
      return state.logs.slice(-Math.max(1, Math.min(2000, lines)));
    },
  };
  return api;
}
