/**
 * The package's backups on the box (naming contract in the package's task-1
 * report), described for people. Only names and times are known to the UI;
 * the owner downloads one with `POST /api/avado/backups/download`.
 *
 *   <version>-<YYYYMMDDTHHMMSSZ>       made by the package on an upgrade or after the wallet changed
 *   legacy-<ts>                        the first upgrade from the old (0.0.x) package; kept for good
 *   <ts>-before-wallet-change[-N]      before a wallet change
 *   <ts>-after-wallet-create[-N]       right after the wallet was first saved (kind "wallet-create")
 *   <ts>-manual-download[-N]           made when the owner downloaded a fresh backup (kind "manual")
 *   mnemonic-archive-<ts>[-N]          the old plaintext recovery-phrase file, moved out of the data folder (kind "mnemonic-archive")
 */
import type { BackupInfo } from "../../api/models";

const TS = "(\\d{8}T\\d{6}Z)";

export interface BackupView {
  name: string;
  title: string;
  text: string;
  /** ms, from the name when it has a time stamp, else from the folder's time. */
  time: number | null;
  /** It holds the old package's plain-text recovery phrase. */
  phrase: boolean;
}

/** "20260923T101500Z" → ms. */
export function stampToMs(stamp: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isFinite(t) ? t : null;
}

export function describeBackup(b: BackupInfo): BackupView {
  const base = { name: b.name, phrase: false };
  const folderTime = b.createdAt ? Date.parse(b.createdAt) : NaN;
  const fallbackTime = Number.isFinite(folderTime) ? folderTime : null;
  let m: RegExpExecArray | null;
  // The backend adds "-2", "-3"… when the time-stamped name is taken, and reports the kind.
  if ((m = new RegExp(`^mnemonic-archive-${TS}(?:-\\d+)?$`).exec(b.name)) || b.kind === "mnemonic-archive") {
    return {
      ...base,
      phrase: true,
      title: "Old recovery phrase file",
      text: "The old package's unprotected copy of your recovery phrase (24 words). Anyone who reads it controls your node wallet.",
      time: (m ? stampToMs(m[1]) : null) ?? fallbackTime,
    };
  }
  if ((m = new RegExp(`^${TS}-after-wallet-create(?:-\\d+)?$`).exec(b.name)) || b.kind === "wallet-create") {
    return {
      ...base,
      title: "After creating your wallet",
      text: "Your node wallet and its password (and validator keys, if it had any), saved right after the wallet was set up. It is never deleted.",
      time: (m ? stampToMs(m[1]) : null) ?? fallbackTime,
    };
  }
  if ((m = new RegExp(`^${TS}-manual-download(?:-\\d+)?$`).exec(b.name)) || b.kind === "manual") {
    return {
      ...base,
      title: "Downloaded by you",
      text: "Made when you pressed Download backup: your node wallet, its password and your validator keys. The 10 newest of these are kept.",
      time: (m ? stampToMs(m[1]) : null) ?? fallbackTime,
    };
  }
  if ((m = new RegExp(`^${TS}-before-wallet-change(?:-\\d+)?$`).exec(b.name))) {
    return { ...base, title: "Before a wallet change", text: "Your node wallet, its password and your validator keys, as they were before the wallet was changed.", time: stampToMs(m[1]) ?? fallbackTime };
  }
  if ((m = new RegExp(`^legacy-${TS}$`).exec(b.name))) {
    return {
      ...base,
      title: "Before the upgrade from the old package",
      text: "Your node wallet, its password, your validator keys and settings, from before this version was installed. It is never deleted.",
      time: stampToMs(m[1]) ?? fallbackTime,
    };
  }
  if ((m = new RegExp(`^([A-Za-z0-9._+-]+)-${TS}$`).exec(b.name))) {
    return {
      ...base,
      title: `Automatic backup (from version ${m[1]})`,
      text: "Made on an update, or after new validator keys were added: your node wallet, its password and your validator keys.",
      time: stampToMs(m[2]) ?? fallbackTime,
    };
  }
  return { ...base, title: "Backup", text: b.kind === "wallet-change" ? "Made before a wallet change." : "A backup made by the Rocket Pool package.", time: fallbackTime };
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
