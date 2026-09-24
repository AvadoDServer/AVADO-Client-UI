/**
 * The backups folder on the box (`/rocketpool/backups`, naming contract in
 * the package's task-1 report), described for people. Only names and times
 * are known to the UI; never contents.
 *
 *   <version>-<YYYYMMDDTHHMMSSZ>       made by the package on an upgrade or after the wallet changed
 *   legacy-<ts>                        the first upgrade from the old (0.0.x) package; kept for good
 *   <ts>-before-wallet-change[-N]      before a wallet change
 *   mnemonic-archive-<ts>[-N]          the old plaintext recovery-phrase file, moved out of the data folder (kind "mnemonic-archive")
 */
import type { BackupInfo } from "../../api/models";

export const BACKUP_DIR = "/rocketpool/backups";
export const PACKAGE_NAME = "rocketpool.avado.dnp.dappnode.eth";
/** The package's page in the AVADO Admin (File manager → Download from DApp). */
export const ADMIN_PACKAGE_URL = `http://my.ava.do/#/packages/${PACKAGE_NAME}`;

const TS = "(\\d{8}T\\d{6}Z)";

export interface BackupView {
  name: string;
  path: string;
  title: string;
  text: string;
  /** ms, from the name when it has a time stamp, else from the folder's time. */
  time: number | null;
}

/** "20260923T101500Z" → ms. */
export function stampToMs(stamp: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isFinite(t) ? t : null;
}

export function describeBackup(b: BackupInfo): BackupView {
  const base = { name: b.name, path: `${BACKUP_DIR}/${b.name}` };
  const folderTime = b.createdAt ? Date.parse(b.createdAt) : NaN;
  const fallbackTime = Number.isFinite(folderTime) ? folderTime : null;
  let m: RegExpExecArray | null;
  // The backend adds "-2", "-3"… when the time-stamped name is taken, and reports the kind.
  if ((m = new RegExp(`^mnemonic-archive-${TS}(?:-\\d+)?$`).exec(b.name)) || b.kind === "mnemonic-archive") {
    return {
      ...base,
      title: "Old recovery phrase file",
      text: "The plaintext recovery phrase the old package kept, moved out of the data folder. Anyone with it controls your node wallet.",
      time: (m ? stampToMs(m[1]) : null) ?? fallbackTime,
    };
  }
  if ((m = new RegExp(`^${TS}-before-wallet-change(?:-\\d+)?$`).exec(b.name))) {
    return { ...base, title: "Before a wallet change", text: "The wallet, its password and the validator keys as they were before the wallet was changed.", time: stampToMs(m[1]) ?? fallbackTime };
  }
  if ((m = new RegExp(`^legacy-${TS}$`).exec(b.name))) {
    return {
      ...base,
      title: "Before the upgrade from the old package",
      text: "The wallet, password, validator keys and settings from before this version was installed. Kept for good.",
      time: stampToMs(m[1]) ?? fallbackTime,
    };
  }
  if ((m = new RegExp(`^([A-Za-z0-9._+-]+)-${TS}$`).exec(b.name))) {
    return {
      ...base,
      title: `Automatic backup (from version ${m[1]})`,
      text: "Made on an update, or after the wallet changed (for example new validator keys): the wallet, its password and the validator keys.",
      time: stampToMs(m[2]) ?? fallbackTime,
    };
  }
  return { ...base, title: "Backup", text: b.kind === "wallet-change" ? "Made before a wallet change." : "A backup folder.", time: fallbackTime };
}

/** Newest first. */
export const describeBackups = (list: BackupInfo[]): BackupView[] =>
  list.map(describeBackup).sort((a, b) => (b.time ?? 0) - (a.time ?? 0));

/**
 * The wallet export as one file for the owner to keep: Smartnode's wallet
 * file, its password and the node account's private key. Never stored by
 * the app; built only when the owner asks to download it.
 */
export function exportFileContent(e: { wallet: string; password: string; accountPrivateKey: string }, nodeAddress: string, now = new Date()): string {
  return JSON.stringify(
    {
      about:
        "AVADO Rocket Pool node wallet backup. Anyone with this file controls your node wallet and its funds: keep it offline and private. To restore, AVADO support puts 'walletFile' back as the Rocket Pool 'wallet' file and 'password' as its 'password' file.",
      nodeAddress,
      createdAt: now.toISOString(),
      walletFile: e.wallet,
      password: e.password,
      accountPrivateKey: e.accountPrivateKey,
    },
    null,
    2,
  );
}
