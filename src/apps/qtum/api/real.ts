import { QtumApiError } from "./errors";
import { parseSettings, parseWalletStatus, type BackupDownload, type SettingsPatch, type StakingSummary } from "./models";
import type { QtumApi } from "./types";

/** The package's routes, on the UI's own origin. */
export const RPC_PATH = "/rpc";
export const MONITOR = "/monitor";

/** The monitor answers calls that touch keys or the wallet only with this header (nginx keeps other sites from sending it). */
export const WIZARD_HEADER = "X-Qtum-Wizard";

export const READ_TIMEOUT_MS = 30_000;
/** nginx gives the node and the monitor 90 s. */
export const WRITE_TIMEOUT_MS = 95_000;
/** A backup is written by the node first. */
export const BACKUP_TIMEOUT_MS = 150_000;
export const UPLOAD_TIMEOUT_MS = 300_000;

/** The file name to save a backup under: the monitor's when it is a plain name, else the old wizard's. */
export function backupFileName(contentDisposition: string | null, today = new Date()): string {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition ?? "");
  let given = "";
  try {
    given = m ? decodeURIComponent(m[1].trim()) : "";
  } catch {
    given = "";
  }
  if (/^[A-Za-z0-9][A-Za-z0-9._+-]{0,150}$/.test(given) && !given.includes("..")) return given;
  return `qtum-wallet-${today.toISOString().slice(0, 10)}.dat`;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

interface Spec {
  method: "GET" | "POST";
  path: string;
  /** JSON, or a file sent as it is. */
  body?: unknown;
  raw?: Blob;
  timeoutMs: number;
}

let rpcId = 0;

/** Adapters for the Qtum package (same origin as the UI). */
export function createRealQtumApi(fetchImpl: typeof fetch = (...args) => fetch(...args)): QtumApi {
  async function send({ method, path, body, raw, timeoutMs }: Spec, accept = "application/json"): Promise<Response> {
    const headers: Record<string, string> = { Accept: accept, [WIZARD_HEADER]: "1" };
    let payload: BodyInit | undefined;
    if (raw) {
      headers["Content-Type"] = "application/octet-stream";
      payload = raw;
    } else if (method === "POST") {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body ?? {});
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      return await fetchImpl(path, {
        method,
        headers,
        body: payload,
        signal: controller.signal,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
      });
    } catch (cause) {
      throw new QtumApiError({ kind: timedOut ? "timeout" : "unreachable", path, cause });
    } finally {
      clearTimeout(timer);
    }
  }

  async function readJson(res: Response, path: string): Promise<{ data: unknown; parsed: boolean }> {
    let text: string;
    try {
      text = await res.text();
    } catch (cause) {
      throw new QtumApiError({ kind: "unreachable", path, cause });
    }
    try {
      return { data: text === "" ? undefined : JSON.parse(text), parsed: true };
    } catch {
      return { data: undefined, parsed: false };
    }
  }

  async function monitor<T>(spec: Spec): Promise<T> {
    const res = await send(spec);
    const { data, parsed } = await readJson(res, spec.path);
    const detail = isObject(data) && typeof data.error === "string" && data.error.trim() ? data.error.trim() : undefined;
    if (!res.ok) throw new QtumApiError({ kind: "http", path: spec.path, status: res.status, detail });
    if (!parsed) throw new QtumApiError({ kind: "invalid", path: spec.path, status: res.status, detail: "The answer is not JSON" });
    return data as T;
  }

  async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    const path = `rpc ${method}`;
    rpcId += 1;
    const timeoutMs = method === "walletpassphrase" || method === "getnewaddress" || method === "walletlock" ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS;
    const res = await send({ method: "POST", path: RPC_PATH, body: { jsonrpc: "1.0", id: `ui-${rpcId}`, method, params }, timeoutMs });
    const { data } = await readJson(res, path);
    // The node answers an error with HTTP 500 (or 404 for an unknown method) and the error in the body.
    if (isObject(data) && isObject(data.error)) {
      const err = data.error;
      throw new QtumApiError({
        kind: "rpc",
        path,
        status: res.status,
        code: typeof err.code === "number" ? err.code : undefined,
        detail: typeof err.message === "string" ? err.message : undefined,
      });
    }
    if (!res.ok) throw new QtumApiError({ kind: "http", path, status: res.status });
    if (!isObject(data) || !("result" in data)) throw new QtumApiError({ kind: "invalid", path, status: res.status, detail: "Not an RPC answer" });
    return data.result as T;
  }

  const post = (path: string, body: unknown = {}, timeoutMs = WRITE_TIMEOUT_MS) => monitor<unknown>({ method: "POST", path: `${MONITOR}${path}`, body, timeoutMs });

  return {
    rpc,

    async walletStatus() {
      const path = `${MONITOR}/walletstatus`;
      const status = parseWalletStatus(await monitor<unknown>({ method: "GET", path, timeoutMs: READ_TIMEOUT_MS }));
      if (!status) throw new QtumApiError({ kind: "invalid", path, detail: "Not a wallet status" });
      return status;
    },

    async settings() {
      const path = `${MONITOR}/getenv`;
      const s = parseSettings(await monitor<unknown>({ method: "GET", path, timeoutMs: READ_TIMEOUT_MS }));
      if (!s) throw new QtumApiError({ kind: "invalid", path, detail: "Not the settings" });
      return s;
    },

    async saveSettings(patch: SettingsPatch) {
      const path = `${MONITOR}/setenv`;
      const s = parseSettings(await post("/setenv", patch));
      if (!s) throw new QtumApiError({ kind: "invalid", path, detail: "Not the settings" });
      return s;
    },

    async restartNode() {
      await post("/restartQtum");
    },

    async backupDone() {
      await post("/backupdone");
    },

    async downloadBackup(): Promise<BackupDownload> {
      const path = `${MONITOR}/backup`;
      const res = await send({ method: "POST", path, body: {}, timeoutMs: BACKUP_TIMEOUT_MS }, "application/octet-stream, application/json");
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!res.ok) {
        const { data } = await readJson(res, path);
        const detail = isObject(data) && typeof data.error === "string" && data.error.trim() ? data.error.trim() : undefined;
        throw new QtumApiError({ kind: "http", path, status: res.status, detail });
      }
      // A 200 that isn't a file (an older package answering with its web page) is not a backup.
      if (type.includes("json") || type.includes("html") || type.startsWith("text/")) {
        throw new QtumApiError({ kind: "invalid", path, status: res.status, detail: "The answer is not a backup file" });
      }
      let blob: Blob;
      try {
        blob = await res.blob();
      } catch (cause) {
        throw new QtumApiError({ kind: "unreachable", path, cause });
      }
      if (blob.size === 0) throw new QtumApiError({ kind: "invalid", path, status: res.status, detail: "The backup file is empty" });
      return { blob, fileName: backupFileName(res.headers.get("content-disposition")) };
    },

    async uploadBackup(file: Blob) {
      const path = `${MONITOR}/uploadbackup`;
      const data = await monitor<unknown>({ method: "POST", path, raw: file, timeoutMs: UPLOAD_TIMEOUT_MS });
      if (!isObject(data) || typeof data.file !== "string") throw new QtumApiError({ kind: "invalid", path, detail: "No file name" });
      return data.file;
    },

    async restoreBackup(file: string) {
      await post("/restore", { file });
    },

    async retryUpgrade(passphrase?: string) {
      await post("/migrate", passphrase ? { passphrase } : {});
    },

    async rebuildWallet(passphrase?: string) {
      await post("/rebuild", passphrase ? { passphrase } : {});
    },

    async privateKey(address: string) {
      const path = `${MONITOR}/privkey`;
      const data = await post("/privkey", { address });
      if (!isObject(data) || typeof data.privateKey !== "string") throw new QtumApiError({ kind: "invalid", path, detail: "No key in the answer" });
      return data.privateKey;
    },

    async importKey(privateKey: string) {
      await post("/importkey", { privateKey });
    },

    async stakingSummary() {
      const path = `${MONITOR}/staking-summary`;
      const data = await monitor<unknown>({ method: "GET", path, timeoutMs: 130_000 });
      if (!isObject(data) || typeof data.totalRewards !== "number") throw new QtumApiError({ kind: "invalid", path, detail: "Not a staking summary" });
      return data as unknown as StakingSummary;
    },

    async logs(lines = 200) {
      const n = Math.max(1, Math.min(2000, Math.floor(lines)));
      const path = `${MONITOR}/logs?lines=${n}`;
      const data = await monitor<unknown>({ method: "GET", path, timeoutMs: READ_TIMEOUT_MS });
      if (!isObject(data) || !Array.isArray(data.lines)) throw new QtumApiError({ kind: "invalid", path, detail: "Not log lines" });
      return data.lines.map(String);
    },
  };
}
