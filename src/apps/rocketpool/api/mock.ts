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
 *  - Nothing changes state: after a transaction the fixtures read the same.
 */
import { RpApiError } from "./errors";
import { DemoSnError, SCENARIOS, demoHex, isScenarioName, type MockScenario, type MockScenarioName } from "./fixtures";
import type { AvadoStatus, LogsView, ReconcileView, SnEnvelope } from "./models";
import { AVADO_LOGS_PATH, AVADO_RECONCILE_PATH, AVADO_RECONCILE_RUN_PATH, AVADO_STATUS_PATH, SN_PREFIX, assertRoute } from "./real";
import type { RocketpoolApi, SnParams } from "./types";

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
  params: SnParams;
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** "node/can-distribute" → "canDistribute"; "megapool/can-exit-validator" → "canExitValidator". */
export function canFlag(route: string): string | null {
  const last = route.split("/").pop() ?? "";
  if (!last.startsWith("can-")) return null;
  return last.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** The field a write route names its tx hash with. */
export function txHashField(route: string): string {
  if (route === "node/stake-rpl") return "stakeTxHash";
  if (route === "node/stake-rpl-approve-rpl") return "approveTxHash";
  return "txHash";
}

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

  const delay = async (ms = latencyMs) => {
    if (ms > 0) await sleep(ms);
  };

  async function enter(method: "GET" | "POST", path: string, params: SnParams = {}) {
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
      return clone(scenario.avado) as AvadoStatus;
    },

    async reconcile() {
      await enter("GET", AVADO_RECONCILE_PATH);
      return clone(scenario.reconcile) as ReconcileView;
    },

    async requestReconcile() {
      await enter("POST", AVADO_RECONCILE_RUN_PATH);
    },

    async logs(tail = 200) {
      await enter("GET", `${AVADO_LOGS_PATH}?tail=${tail}`);
      return { available: true, lines: scenario.logLines.slice(-tail) } as LogsView;
    },

    async snGet<T extends SnEnvelope>(route: string, params: SnParams = {}) {
      assertRoute(route);
      const path = `${SN_PREFIX}${route}`;
      await enter("GET", path, params);
      daemonCheck(route, path);

      if (route === "wait") {
        await delay(waitMs);
        if (txOutcome === "revert") fail(path, new DemoSnError(500, TX_FAILED));
        return { status: "success", error: "" } as T;
      }
      if (route in reads) return answer<T>(path, reads[route]);
      if (route in scenario.reads) return answer<T>(path, scenario.reads[route]);
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

      txCount += 1;
      return { status: "success", error: "", [txHashField(route)]: `0x${demoHex(9000 + txCount, 32)}` } as unknown as T;
    },
  };
}
