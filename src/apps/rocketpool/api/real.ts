import { RpApiError } from "./errors";
import { parseAvadoStatus } from "./avado";
import { CURRENT_BACKUP, type ApproveKeysResult, type BackupDownload, type LegacyMnemonicArchiveResult, type LogsView, type ReconcileView, type SnEnvelope } from "./models";
import type { CallOptions, RocketpoolApi, SnParams } from "./types";

/** The package backend's routes, on the UI's own origin. */
export const AVADO_STATUS_PATH = "/api/avado/status";
export const AVADO_RECONCILE_PATH = "/api/avado/reconcile";
export const AVADO_RECONCILE_RUN_PATH = "/api/avado/reconcile/run";
export const AVADO_RECONCILE_APPROVE_PATH = "/api/avado/reconcile/approve";
export const AVADO_LOGS_PATH = "/api/avado/logs";
export const AVADO_LEGACY_MNEMONIC_ARCHIVE_PATH = "/api/avado/legacy-mnemonic/archive";
export const AVADO_BACKUP_DOWNLOAD_PATH = "/api/avado/backups/download";
export const SN_PREFIX = "/api/sn/";

/** The backend refuses a write without this header (its CSRF guard). */
export const AVADO_REQUEST_HEADER = "X-Avado-Request";

/** Reads: Smartnode's node/status can take a while on a busy node. */
export const READ_TIMEOUT_MS = 60_000;
/** Writes: the backend gives the daemon 120 s; a little more here so its own answer arrives. */
export const WRITE_TIMEOUT_MS = 150_000;
/** Routes that block until something happens (a tx mined, a wallet recovered); the backend allows 60 min. */
export const LONG_TIMEOUT_MS = 65 * 60_000;

/**
 * Must match the backend's long routes (W_LONG / R_LONG). `node/deposit` is
 * one: the backend waits for the daemon (60 min) and records the new keys even
 * when the page gives up, so the page must not give up first.
 */
export const LONG_ROUTES: ReadonlySet<string> = new Set([
  "wait",
  "node/deposit",
  "wallet/recover",
  "wallet/search-and-recover",
]);

/** `node/status`, `megapool/can-exit-validator`: lower-case segments only, so a route can never climb out of /api/sn/. */
const ROUTE = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;

export function assertRoute(route: string): void {
  if (!ROUTE.test(route)) throw new TypeError(`Not a Smartnode route: ${JSON.stringify(route)}`);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A backup's name as the status lists it ("0.0.107-20260923T101500Z"), or "current". Never a path. */
export function isBackupName(name: string): boolean {
  return name === CURRENT_BACKUP || (/^[A-Za-z0-9][A-Za-z0-9._+-]{0,199}$/.test(name) && !name.includes(".."));
}

/**
 * The file name to save a backup under: the backend's `Content-Disposition`
 * name when it is a plain .zip name, else one made from the backup's name.
 */
export function backupFileName(name: string, contentDisposition: string | null): string {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition ?? "");
  let given = "";
  try {
    given = m ? decodeURIComponent(m[1].trim()) : "";
  } catch {
    given = "";
  }
  if (/^[A-Za-z0-9][A-Za-z0-9._+-]{0,150}\.zip$/.test(given) && !given.includes("..")) return given;
  return name === CURRENT_BACKUP ? "rocketpool-wallet-backup.zip" : `rocketpool-backup-${name}.zip`;
}

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
      request<LegacyMnemonicArchiveResult>({
        method: "POST",
        path: AVADO_LEGACY_MNEMONIC_ARCHIVE_PATH,
        body: { confirm },
        timeoutMs: WRITE_TIMEOUT_MS,
        envelope: true,
      }),

    async downloadBackup(name: string, opts: CallOptions = {}): Promise<BackupDownload> {
      if (!isBackupName(name)) throw new TypeError(`Not a backup name: ${JSON.stringify(name)}`);
      const path = AVADO_BACKUP_DOWNLOAD_PATH;
      const { signal } = opts;
      if (signal?.aborted) throw new RpApiError({ kind: "aborted", path });
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, opts.timeoutMs ?? WRITE_TIMEOUT_MS);
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort);
      try {
        let res: Response;
        try {
          res = await fetchImpl(path, {
            method: "POST",
            headers: {
              Accept: "application/zip, application/json",
              "Content-Type": "application/json",
              [AVADO_REQUEST_HEADER]: "1",
            },
            body: JSON.stringify({ name }),
            signal: controller.signal,
            credentials: "same-origin",
            cache: "no-store",
            redirect: "error",
          });
        } catch (cause) {
          throw new RpApiError({ kind: timedOut ? "timeout" : signal?.aborted ? "aborted" : "unreachable", path, cause });
        }
        const type = (res.headers.get("content-type") ?? "").toLowerCase();
        if (!res.ok) {
          let detail: string | undefined;
          try {
            const data: unknown = JSON.parse(await res.text());
            if (isObject(data) && typeof data.error === "string" && data.error.trim()) detail = data.error.trim();
          } catch {
            /* not JSON: the status says enough */
          }
          throw new RpApiError({ kind: "http", path, status: res.status, detail });
        }
        // A 200 that isn't a file (an older package answering with its web page) is not a backup.
        if (type.includes("json") || type.includes("html") || type.startsWith("text/")) {
          throw new RpApiError({ kind: "invalid", path, status: res.status, detail: "The answer is not a backup file" });
        }
        let blob: Blob;
        try {
          blob = await res.blob();
        } catch (cause) {
          throw new RpApiError({ kind: timedOut ? "timeout" : signal?.aborted ? "aborted" : "unreachable", path, cause });
        }
        if (blob.size === 0) throw new RpApiError({ kind: "invalid", path, status: res.status, detail: "The backup file is empty" });
        return { blob, fileName: backupFileName(name, res.headers.get("content-disposition")) };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },

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
