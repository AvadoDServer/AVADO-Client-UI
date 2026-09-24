/**
 * In-memory backend for `VITE_MOCK=1` and tests, on the fixtures in
 * `fixtures.ts`. It answers like the package backend: the same envelopes,
 * the same error statuses (502 while the daemon is down, 409 for a wallet
 * that exists, 400 for a missing export confirmation).
 *
 * Mock conventions:
 *  - Any `…/can-x` read not in the scenario answers "yes" (`canX: true`)
 *    with a gas estimate.
 *  - Any write that isn't a wallet route answers with a fresh demo tx hash;
 *    `wait` then succeeds after `waitMs`, or fails with `txOutcome: "revert"`.
 *  - Nothing changes state after a transaction: the fixtures read the same.
 *    The one exception is approving keys: they then read as loaded.
 */
import { RpApiError } from "./errors";
import { DemoSnError, SCENARIOS, demoBondRequirement, demoHex, isScenarioName, type MockScenario, type MockScenarioName } from "./fixtures";
import {
  APPROVE_CONFIRMATION,
  ARCHIVE_CONFIRMATION,
  type ApproveKeysResult,
  type ArchiveMnemonicResult,
  type AvadoStatus,
  type LogsView,
  type ReconcileView,
  type SnEnvelope,
} from "./models";
import { normalizePubkey } from "./reconcile";
import { canFlag } from "./sn";

export { canFlag };
import {
  AVADO_ARCHIVE_MNEMONIC_PATH,
  AVADO_LOGS_PATH,
  AVADO_RECONCILE_APPROVE_PATH,
  AVADO_RECONCILE_PATH,
  AVADO_RECONCILE_RUN_PATH,
  AVADO_STATUS_PATH,
  SN_PREFIX,
  assertRoute,
} from "./real";
import type { CallOptions, RocketpoolApi, SnParams } from "./types";

export type MockFailure = DemoSnError | "unreachable" | "timeout";

export interface RocketpoolMockOptions {
  /** Which demo node (default "mixed"). */
  scenario?: MockScenarioName;
  /** Simulated latency per call (ms). */
  latencyMs?: number;
  /** How long `wait` takes before the tx is "mined" (ms, default 4 × latency). */
  waitMs?: number;
  /** "revert": every tx is mined but fails. */
  txOutcome?: "success" | "revert";
  /** The package backend is down: every call fails as unreachable. */
  backendDown?: boolean;
  /** Per Smartnode route (`node/distribute`): fail this way instead. */
  failures?: Record<string, MockFailure>;
  /** Per Smartnode route: answer this instead of the scenario's data. */
  reads?: Record<string, unknown>;
}

export interface MockCall {
  method: "GET" | "POST";
  path: string;
  params: Record<string, unknown>;
}

export interface MockRocketpoolApi extends RocketpoolApi {
  /** Every call made, in order (for tests). */
  readonly calls: MockCall[];
  readonly scenario: MockScenario;
}

export const WALLET_EXISTS_MESSAGE =
  "This AVADO already has a Rocket Pool wallet. Contact support@ava.do if you need to change it.";
const EXPORT_REFUSED = 'Type EXPORT to confirm the wallet export (typedConfirmation must be "EXPORT").';
const DAEMON_DOWN = "The Rocket Pool daemon is not reachable (it may still be starting).";
const TX_FAILED = "Transaction failed with status 0";
const APPROVE_REFUSED =
  'Type LOAD to confirm that these validators are not running anywhere else (confirm must be "LOAD").';

/** The scenario's key-check status as it reads after the owner approved `approved` (they load on the next run). */
function withApproved(view: ReconcileView, approved: ReadonlySet<string>): ReconcileView {
  const s = view.status as Record<string, unknown> | undefined;
  if (!s || approved.size === 0 || !Array.isArray(s.awaitingApproval)) return view;
  const waiting = s.awaitingApproval as string[];
  const loaded = waiting.filter((k) => approved.has(k));
  if (loaded.length === 0) return view;
  const keys = s.keys as { total: number; inSync: number; imported: number; summary: string };
  const inSync = keys.inSync + loaded.length;
  const stillWaiting = waiting.filter((k) => !approved.has(k));
  const chosen = (s.client as { package?: string } | null)?.package;
  const validators = (s.validators as Array<Record<string, unknown>>).map((v) =>
    loaded.includes(v.pubkey as string)
      ? {
          ...v,
          state: "imported",
          loadedIn: chosen ? [chosen] : [],
          feeRecipient: { ...(v.feeRecipient as object), state: "fixed", clients: chosen ? [{ package: chosen, found: null, state: "fixed" }] : [] },
        }
      : v,
  );
  const clientName = (s.client as { name?: string } | null)?.name ?? "the consensus client";
  const done = stillWaiting.length === 0 && inSync === keys.total && ((s.errors as string[]) ?? []).length === 0;
  return {
    ...view,
    status: {
      ...s,
      state: done ? "ok" : s.state,
      message: `Validator keys in sync with ${clientName}: ${inSync}/${keys.total}.`,
      trigger: "request",
      awaitingApproval: stillWaiting,
      keys: { ...keys, inSync, imported: loaded.length, summary: `${inSync}/${keys.total}` },
      validators,
    },
  };
}

/** Resolves after `ms`, or rejects as `aborted` when the signal fires first. */
function sleep(ms: number, signal?: AbortSignal, path = ""): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new RpApiError({ kind: "aborted", path }));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new RpApiError({ kind: "aborted", path }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The field a write route names its tx hash with. */
export function txHashField(route: string): string {
  if (route === "node/stake-rpl") return "stakeTxHash";
  if (route === "node/stake-rpl-approve-rpl") return "approveTxHash";
  return "txHash";
}

/** Write routes that sign a beacon-chain message instead of sending a transaction (Smartnode answers without a hash). */
export const OFF_CHAIN_ROUTES: ReadonlySet<string> = new Set(["minipool/exit", "megapool/exit-validator"]);

export const DEMO_GAS_LIMITS = { estimated: 145_000, safe: 217_500 } as const;

/** The scenario for `VITE_MOCK=1`: `?scenario=` in the page address, else VITE_MOCK_SCENARIO, else "mixed". */
export function scenarioFromEnvironment(): MockScenarioName {
  let fromUrl: string | null = null;
  try {
    fromUrl = new URLSearchParams(window.location.search).get("scenario");
  } catch {
    /* no window */
  }
  if (isScenarioName(fromUrl)) return fromUrl;
  const fromEnv: unknown = import.meta.env.VITE_MOCK_SCENARIO;
  return isScenarioName(fromEnv) ? fromEnv : "mixed";
}

export function createMockRocketpoolApi(options: RocketpoolMockOptions = {}): MockRocketpoolApi {
  const { latencyMs = 0, backendDown = false, txOutcome = "success", failures = {}, reads = {} } = options;
  const waitMs = options.waitMs ?? latencyMs * 4;
  const scenario = SCENARIOS[options.scenario ?? "mixed"];
  const calls: MockCall[] = [];
  let txCount = 0;
  /** Keys the owner approved in this mock: the next status shows them loaded. */
  const approved = new Set<string>();
  /** The legacy recovery-phrase file was moved into this backup (then the status no longer reports it). */
  let mnemonicArchive: string | null = null;

  const delay = async (ms = latencyMs, signal?: AbortSignal, path?: string) => {
    if (ms > 0 || signal?.aborted) await sleep(ms, signal, path);
  };

  async function enter(method: "GET" | "POST", path: string, params: Record<string, unknown> = {}) {
    calls.push({ method, path, params: { ...params } });
    await delay();
    if (backendDown) throw new RpApiError({ kind: "unreachable", path });
  }

  function fail(path: string, f: MockFailure): never {
    if (f === "unreachable") throw new RpApiError({ kind: "unreachable", path });
    if (f === "timeout") throw new RpApiError({ kind: "timeout", path });
    throw new RpApiError({ kind: "http", path, status: f.status, detail: f.message });
  }

  function answer<T>(path: string, value: unknown): T {
    if (value instanceof DemoSnError) fail(path, value);
    return clone(value) as T;
  }

  function daemonCheck(route: string, path: string) {
    const f = failures[route];
    if (f) fail(path, f);
    if (scenario.daemonDown) throw new RpApiError({ kind: "http", path, status: 502, detail: DAEMON_DOWN });
  }

  return {
    calls,
    scenario,

    async avadoStatus() {
      await enter("GET", AVADO_STATUS_PATH);
      const status = clone(scenario.avado) as AvadoStatus;
      if (mnemonicArchive) {
        status.legacyMnemonicPresent = false;
        status.backups = [{ name: mnemonicArchive, createdAt: "2026-09-23T10:15:00Z", kind: "upgrade" }, ...status.backups];
      }
      return status;
    },

    async reconcile() {
      await enter("GET", AVADO_RECONCILE_PATH);
      return withApproved(clone(scenario.reconcile) as ReconcileView, approved);
    },

    async requestReconcile() {
      await enter("POST", AVADO_RECONCILE_RUN_PATH);
    },

    async approveKeys(pubkeys: string[], confirm: string) {
      const path = AVADO_RECONCILE_APPROVE_PATH;
      await enter("POST", path, { pubkeys: [...pubkeys], confirm });
      // The backend's checks: exact confirmation, 1..1000 valid pubkeys, nothing written otherwise.
      if (confirm !== APPROVE_CONFIRMATION) fail(path, new DemoSnError(400, APPROVE_REFUSED));
      const keys = pubkeys.map(normalizePubkey);
      if (keys.length === 0 || keys.length > 1000 || keys.some((k) => k === null)) {
        fail(path, new DemoSnError(400, "pubkeys must be a list of 1 to 1000 validator public keys."));
      }
      const unique = [...new Set(keys as string[])];
      const added = unique.filter((k) => !approved.has(k)).length;
      unique.forEach((k) => approved.add(k));
      return { status: "success", error: "", approved: unique.length, added, runRequested: true } as ApproveKeysResult;
    },

    async archiveLegacyMnemonic(confirm: string) {
      const path = AVADO_ARCHIVE_MNEMONIC_PATH;
      await enter("POST", path, { confirm });
      if (confirm !== ARCHIVE_CONFIRMATION) fail(path, new DemoSnError(400, 'Type ARCHIVE to confirm (confirm must be "ARCHIVE").'));
      if (!scenario.avado.legacyMnemonicPresent || mnemonicArchive) fail(path, new DemoSnError(404, "There is no legacy mnemonic file."));
      mnemonicArchive = "mnemonic-archive-20260923T101500Z";
      return { status: "success", error: "", archived: true, name: mnemonicArchive } as ArchiveMnemonicResult;
    },

    async logs(tail = 200) {
      await enter("GET", `${AVADO_LOGS_PATH}?tail=${tail}`);
      return { available: true, lines: scenario.logLines.slice(-tail) } as LogsView;
    },

    async snGet<T extends SnEnvelope>(route: string, params: SnParams = {}, opts: CallOptions = {}) {
      assertRoute(route);
      const path = `${SN_PREFIX}${route}`;
      await enter("GET", path, params);
      daemonCheck(route, path);

      if (route === "wait") {
        await delay(waitMs, opts.signal, path);
        if (txOutcome === "revert") fail(path, new DemoSnError(500, TX_FAILED));
        return { status: "success", error: "" } as T;
      }
      if (route in reads) return answer<T>(path, reads[route]);
      if (route in scenario.reads) return answer<T>(path, scenario.reads[route]);
      if (route === "node/get-bond-requirement" && !scenario.daemonDown) {
        return { status: "success", error: "", bondRequirement: demoBondRequirement(Number(params.numValidators) || 0) } as unknown as T;
      }
      const flag = canFlag(route);
      if (flag) return { status: "success", error: "", [flag]: true, gasLimits: { ...DEMO_GAS_LIMITS } } as unknown as T;
      throw new RpApiError({ kind: "http", path, status: 404, detail: "Not in the demo data." });
    },

    async snPost<T extends SnEnvelope>(route: string, body: SnParams = {}) {
      assertRoute(route);
      const path = `${SN_PREFIX}${route}`;
      await enter("POST", path, body);

      // The backend's wallet guards run before the daemon is asked.
      const walletExists = scenario.avado.walletFilePresent;
      if (["wallet/init", "wallet/recover", "wallet/search-and-recover"].includes(route) && walletExists) {
        fail(path, new DemoSnError(409, WALLET_EXISTS_MESSAGE));
      }
      if (route === "wallet/set-password" && scenario.avado.passwordFilePresent) {
        fail(path, new DemoSnError(409, "A wallet password is already set."));
      }
      if (route === "wallet/export" && body.typedConfirmation !== "EXPORT") fail(path, new DemoSnError(400, EXPORT_REFUSED));

      daemonCheck(route, path);

      if (route === "wallet/export") {
        return {
          status: "success",
          error: "",
          password: "demo-password-not-real",
          wallet: '{"demo":"not a real wallet"}',
          accountPrivateKey: "demo-key-not-real",
        } as unknown as T;
      }
      if (route.startsWith("wallet/")) return { status: "success", error: "" } as T;
      // Voluntary exits are signed messages to the beacon chain: no transaction, no hash.
      if (OFF_CHAIN_ROUTES.has(route)) return { status: "success", error: "" } as T;

      txCount += 1;
      return { status: "success", error: "", [txHashField(route)]: `0x${demoHex(9000 + txCount, 32)}` } as unknown as T;
    },
  };
}
