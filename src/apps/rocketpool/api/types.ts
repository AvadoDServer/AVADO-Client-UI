import type { ApproveKeysResult, ArchiveMnemonicResult, AvadoStatus, LogsView, ReconcileView, SnEnvelope } from "./models";

/** Flat request parameters: Smartnode reads strings; the backend takes a flat JSON object. */
export type SnParams = Record<string, string | number | boolean>;

export interface CallOptions {
  /** Override the time limit for this call (ms). */
  timeoutMs?: number;
  /** Cancel the request (it then rejects with an `aborted` RpApiError). */
  signal?: AbortSignal;
}

/**
 * The Rocket Pool app's one door to the package backend (same origin).
 * Every call either resolves with the parsed answer or throws an `RpApiError`.
 */
export interface RocketpoolApi {
  /** `GET /api/avado/status`: daemon, API, wallet files, backups. */
  avadoStatus(): Promise<AvadoStatus>;
  /** `GET /api/avado/reconcile`: the key/fee-recipient loop's last result. */
  reconcile(): Promise<ReconcileView>;
  /** `POST /api/avado/reconcile/run`: ask the loop to run now. */
  requestReconcile(): Promise<void>;
  /**
   * `POST /api/avado/reconcile/approve {pubkeys, confirm}`: the owner allows
   * these keys to be loaded into the consensus client. `confirm` must be the
   * text the owner typed; the backend accepts only exactly "LOAD". Call it
   * only from an explicit owner action.
   */
  approveKeys(pubkeys: string[], confirm: string): Promise<ApproveKeysResult>;
  /**
   * `POST /api/avado/legacy-mnemonic/archive {confirm}`: move the old
   * package's plaintext recovery-phrase file into the backups folder (never
   * deleted). `confirm` must be the text the owner typed ("ARCHIVE").
   */
  archiveLegacyMnemonic(confirm: string): Promise<ArchiveMnemonicResult>;
  /** `GET /api/avado/logs?tail=N`: redacted daemon log lines. */
  logs(tail?: number): Promise<LogsView>;
  /**
   * `GET /api/sn/<route>`: a Smartnode read route (`node/status`,
   * `node/can-register`, `wait`, …). Resolves only for `status: "success"`.
   */
  snGet<T extends SnEnvelope>(route: string, params?: SnParams, opts?: CallOptions): Promise<T>;
  /**
   * `POST /api/sn/<route>`: a Smartnode write route. Sends a transaction or
   * touches the wallet: call it only from an explicit owner action.
   */
  snPost<T extends SnEnvelope>(route: string, body?: SnParams, opts?: CallOptions): Promise<T>;
}
