import { RpApiError } from "./errors";
import { parseAvadoStatus } from "./avado";
import type { ApproveKeysResult, ArchiveMnemonicResult, LogsView, ReconcileView, SnEnvelope } from "./models";
import type { CallOptions, RocketpoolApi, SnParams } from "./types";

/** The package backend's routes, on the UI's own origin. */
export const AVADO_STATUS_PATH = "/api/avado/status";
export const AVADO_RECONCILE_PATH = "/api/avado/reconcile";
export const AVADO_RECONCILE_RUN_PATH = "/api/avado/reconcile/run";
export const AVADO_RECONCILE_APPROVE_PATH = "/api/avado/reconcile/approve";
export const AVADO_LOGS_PATH = "/api/avado/logs";
export const AVADO_ARCHIVE_MNEMONIC_PATH = "/api/avado/legacy-mnemonic/archive";
export const SN_PREFIX = "/api/sn/";

/** The backend refuses a write without this header (its CSRF guard). */
export const AVADO_REQUEST_HEADER = "X-Avado-Request";

/** Reads: Smartnode's node/status can take a while on a busy node. */
export const READ_TIMEOUT_MS = 60_000;
/** Writes: the backend gives the daemon 120 s; a little more here so its own answer arrives. */
export const WRITE_TIMEOUT_MS = 150_000;
/** Routes that block until something happens (a tx mined, a wallet recovered); the backend allows 60 min. */
export const LONG_TIMEOUT_MS = 65 * 60_000;

/** Must match the backend's `long` routes. */
export const LONG_ROUTES: ReadonlySet<string> = new Set([
  "wait",
  "wallet/recover",
  "wallet/search-and-recover",
  "wallet/test-recover",
  "wallet/test-search-and-recover",
  "wallet/rebuild",
  "node/wait-and-stake-rpl",
  "network/download-rewards-file",
]);

/** `node/status`, `megapool/can-exit-validator`: lower-case segments only, so a route can never climb out of /api/sn/. */
const ROUTE = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;

export function assertRoute(route: string): void {
  if (!ROUTE.test(route)) throw new TypeError(`Not a Smartnode route: ${JSON.stringify(route)}`);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

interface RequestSpec {
  method: "GET" | "POST";
  path: string;
  body?: SnParams | Record<string, unknown>;
  timeoutMs: number;
  /** Smartnode envelope: a 200 with `status: "error"` is an error too. */
  envelope: boolean;
  signal?: AbortSignal;
}

/** Adapters for the package backend (same origin as the UI). */
export function createRealRocketpoolApi(fetchImpl: typeof fetch = (...args) => fetch(...args)): RocketpoolApi {
  async function request<T>({ method, path, body, timeoutMs, envelope, signal }: RequestSpec): Promise<T> {
    if (signal?.aborted) throw new RpApiError({ kind: "aborted", path });
    const headers: Record<string, string> = { Accept: "application/json" };
    let payload: string | undefined;
    if (method === "POST") {
      headers[AVADO_REQUEST_HEADER] = "1";
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body ?? {});
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);

    let res: Response;
    let text: string;
    try {
      res = await fetchImpl(path, {
        method,
        headers,
        body: payload,
        signal: controller.signal,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
      });
      text = await res.text();
    } catch (cause) {
      const kind = timedOut ? "timeout" : signal?.aborted ? "aborted" : "unreachable";
      throw new RpApiError({ kind, path, cause });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    let data: unknown;
    let parsed = true;
    try {
      data = text === "" ? undefined : JSON.parse(text);
    } catch {
      parsed = false;
    }
    const detail = isObject(data) && typeof data.error === "string" && data.error.trim() ? data.error.trim() : undefined;

    if (!res.ok) throw new RpApiError({ kind: "http", path, status: res.status, detail });
    if (!parsed || (envelope && !isObject(data))) {
      throw new RpApiError({ kind: "invalid", path, status: res.status, detail: "The answer is not JSON" });
    }
    if (envelope && isObject(data) && data.status !== "success") {
      throw new RpApiError({ kind: "smartnode", path, status: res.status, detail });
    }
    return data as T;
  }

  const snPath = (route: string) => {
    assertRoute(route);
    return `${SN_PREFIX}${route}`;
  };

  return {
    async avadoStatus() {
      const raw = await request<unknown>({ method: "GET", path: AVADO_STATUS_PATH, timeoutMs: READ_TIMEOUT_MS, envelope: false });
      const status = parseAvadoStatus(raw);
      if (!status) throw new RpApiError({ kind: "invalid", path: AVADO_STATUS_PATH, detail: "Not a status answer" });
      return status;
    },

    reconcile: () => request<ReconcileView>({ method: "GET", path: AVADO_RECONCILE_PATH, timeoutMs: READ_TIMEOUT_MS, envelope: false }),

    async requestReconcile() {
      await request<unknown>({ method: "POST", path: AVADO_RECONCILE_RUN_PATH, body: {}, timeoutMs: WRITE_TIMEOUT_MS, envelope: false });
    },

    approveKeys: (pubkeys: string[], confirm: string) =>
      request<ApproveKeysResult>({
        method: "POST",
        path: AVADO_RECONCILE_APPROVE_PATH,
        body: { pubkeys: [...pubkeys], confirm },
        timeoutMs: WRITE_TIMEOUT_MS,
        envelope: true,
      }),

    archiveLegacyMnemonic: (confirm: string) =>
      request<ArchiveMnemonicResult>({
        method: "POST",
        path: AVADO_ARCHIVE_MNEMONIC_PATH,
        body: { confirm },
        timeoutMs: WRITE_TIMEOUT_MS,
        envelope: true,
      }),

    logs: (tail = 200) =>
      request<LogsView>({
        method: "GET",
        path: `${AVADO_LOGS_PATH}?tail=${Math.max(1, Math.min(2000, Math.floor(tail)))}`,
        timeoutMs: READ_TIMEOUT_MS,
        envelope: false,
      }),

    snGet<T extends SnEnvelope>(route: string, params?: SnParams, opts: CallOptions = {}) {
      const path = snPath(route);
      const query = params ? new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString() : "";
      return request<T>({
        method: "GET",
        path: query ? `${path}?${query}` : path,
        timeoutMs: opts.timeoutMs ?? (LONG_ROUTES.has(route) ? LONG_TIMEOUT_MS : READ_TIMEOUT_MS),
        envelope: true,
        signal: opts.signal,
      });
    },

    snPost<T extends SnEnvelope>(route: string, body: SnParams = {}, opts: CallOptions = {}) {
      return request<T>({
        method: "POST",
        path: snPath(route),
        body,
        timeoutMs: opts.timeoutMs ?? (LONG_ROUTES.has(route) ? LONG_TIMEOUT_MS : WRITE_TIMEOUT_MS),
        envelope: true,
        signal: opts.signal,
      });
    },
  };
}
