import type { BackupDownload, QtumSettings, SettingsPatch, StakingSummary, WalletStatus } from "./models";

/**
 * The Qtum app's one door to the package (same origin): the monitor at
 * `/monitor/*` and the Qtum node's JSON-RPC at `/rpc` (nginx adds the RPC
 * password and only serves this page). Every call resolves with the parsed
 * answer or throws a `QtumApiError`.
 */
export interface QtumApi {
  /**
   * `POST /rpc {method, params}` on the default wallet. Calls that change
   * something (`getnewaddress`, `walletpassphrase`, `walletlock`) only from an
   * explicit owner action.
   */
  rpc<T>(method: string, params?: unknown[]): Promise<T>;
  /** `GET /monitor/walletstatus`: upgrade, rebuild, restore, import, backup state. */
  walletStatus(): Promise<WalletStatus>;
  /** `GET /monitor/getenv`: the delegation settings and the backup flag. */
  settings(): Promise<QtumSettings>;
  /** `POST /monitor/setenv`: changed delegation settings (the node restarts when they change). */
  saveSettings(patch: SettingsPatch): Promise<QtumSettings>;
  /** `POST /monitor/restartQtum`. */
  restartNode(): Promise<void>;
  /** `POST /monitor/backupdone`: the owner has downloaded a backup. */
  backupDone(): Promise<void>;
  /** `POST /monitor/backup`: a fresh wallet backup file. It holds the keys: never keep it. */
  downloadBackup(): Promise<BackupDownload>;
  /** `POST /monitor/uploadbackup`: a backup file to restore; resolves with its name for `restoreBackup`. */
  uploadBackup(file: Blob): Promise<string>;
  /** `POST /monitor/restore {file}`: replace the wallet with the uploaded backup (the current one is kept). */
  restoreBackup(file: string): Promise<void>;
  /** `POST /monitor/migrate {passphrase?}`: try the wallet upgrade again. */
  retryUpgrade(passphrase?: string): Promise<void>;
  /** `POST /monitor/rebuild {passphrase?}`: rebuild the wallet from the copy of the old one. */
  rebuildWallet(passphrase?: string): Promise<void>;
  /** `POST /monitor/privkey {address}`: the address's private key (WIF). Show it, never keep it. */
  privateKey(address: string): Promise<string>;
  /** `POST /monitor/importkey {privateKey}`: starts an import; `walletStatus().import` follows it. */
  importKey(privateKey: string): Promise<void>;
  /** `GET /monitor/staking-summary`: rewards totals (cached by the monitor for 60 s). */
  stakingSummary(): Promise<StakingSummary>;
  /** `GET /monitor/logs?lines=N`: the node's last log lines, keys hidden. */
  logs(lines?: number): Promise<string[]>;
}
