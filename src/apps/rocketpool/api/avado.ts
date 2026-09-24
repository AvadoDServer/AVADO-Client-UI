/**
 * `GET /api/avado/status`, read defensively: a malformed or older answer
 * never crashes the shell. Anything missing gets the cautious value (not
 * running, not reachable, not present).
 */
import type { AvadoStatus, BackupInfo, DaemonSettings } from "./models";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const bool = (v: unknown): boolean => v === true;
const strings = (v: unknown, max = 50): string[] =>
  (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "") : []).slice(0, max);

const SETTING_KEYS = ["autoTxGasThreshold", "distributeThreshold", "manualMaxFee", "priorityFee"] as const;

/** Plain decimal settings only ("20", "0.01"); anything else is left out. */
function parseSettings(v: unknown): DaemonSettings | undefined {
  if (!isObject(v)) return undefined;
  const out: DaemonSettings = {};
  for (const k of SETTING_KEYS) {
    const raw = typeof v[k] === "number" ? String(v[k]) : v[k];
    if (typeof raw === "string" && /^\d+(\.\d+)?$/.test(raw.trim())) out[k] = raw.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

/** The status, or null when the answer is not a status at all. */
export function parseAvadoStatus(raw: unknown): AvadoStatus | null {
  if (!isObject(raw)) return null;
  const daemon = isObject(raw.daemon) ? raw.daemon : {};
  const backups: BackupInfo[] = (Array.isArray(raw.backups) ? raw.backups : []).flatMap((b) => {
    if (!isObject(b) || !str(b.name)) return [];
    return [{ name: b.name as string, createdAt: str(b.createdAt) ?? "", kind: b.kind === "wallet-change" ? "wallet-change" : "upgrade" }];
  });
  return {
    packageVersion: str(raw.packageVersion),
    network: str(raw.network) ?? "unknown",
    networkSupported: raw.networkSupported !== false, // only an explicit false raises the banner
    daemon: {
      state: (str(daemon.state) ?? "UNKNOWN").toUpperCase(),
      ...(str(daemon.description) ? { description: daemon.description as string } : {}),
      ...(str(daemon.since) ? { since: daemon.since as string } : {}),
      ...(typeof daemon.exitStatus === "number" ? { exitStatus: daemon.exitStatus } : {}),
      ...(str(daemon.error) ? { error: daemon.error as string } : {}),
    },
    apiReachable: bool(raw.apiReachable),
    apiTokenPresent: bool(raw.apiTokenPresent),
    startupError: str(raw.startupError),
    daemonErrors: strings(raw.daemonErrors, 20),
    backups,
    // Unknown means "don't claim it's missing": no false setup or password banners.
    walletFilePresent: raw.walletFilePresent !== false,
    passwordFilePresent: raw.passwordFilePresent !== false,
    legacyMnemonicPresent: bool(raw.legacyMnemonicPresent),
    ...(parseSettings(raw.settings) ? { settings: parseSettings(raw.settings) } : {}),
  };
}
