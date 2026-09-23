import type { BeaconApi, NodeHealth, SyncingStatus } from "../../api/types";
import type { StatusTone } from "../ui";

/** What the status strip shows. Numbers are parsed; missing means "unknown". */
export interface NodeStatus {
  health: NodeHealth;
  syncing?: SyncingStatus;
  /** Connected peers. */
  peers?: number;
  /** Short client version, e.g. "v26.8.0". */
  version?: string;
  /** Advanced only: connected inbound/outbound peers. */
  inbound?: number;
  outbound?: number;
  /** The beacon node reports its execution client offline. */
  elOffline?: boolean;
}

const settled = <T,>(r: PromiseSettledResult<T>): T | undefined => (r.status === "fulfilled" ? r.value : undefined);

/**
 * One status read. Health first: a node that is not ready answers nothing
 * else, so the rest is skipped. The other calls run together and each may
 * fail on its own.
 */
export async function fetchNodeStatus(beacon: BeaconApi, advanced: boolean): Promise<NodeStatus> {
  let health: NodeHealth;
  try {
    health = await beacon.health();
  } catch {
    return { health: "not_ready" };
  }
  if (health === "not_ready") return { health };

  const [syncing, peerCount, version, peers] = await Promise.allSettled([
    beacon.syncing(),
    beacon.peerCount(),
    beacon.version(),
    advanced ? beacon.peers() : Promise.resolve(undefined),
  ]);
  const status: NodeStatus = { health };
  const s = settled(syncing);
  if (s) {
    status.syncing = s;
    status.elOffline = s.el_offline === true;
  }
  const pc = settled(peerCount);
  if (pc && Number.isFinite(Number(pc.connected))) status.peers = Number(pc.connected);
  const v = settled(version);
  if (v) status.version = v;
  const list = settled(peers);
  if (list) {
    const connected = list.filter((p) => p.state === "connected");
    status.inbound = connected.filter((p) => p.direction === "inbound").length;
    status.outbound = connected.filter((p) => p.direction === "outbound").length;
  }
  return status;
}

/** Sync progress as a percentage string, rounded down to two decimals; never 100 while syncing. */
export function syncPercent(s: SyncingStatus): string {
  const head = Number(s.head_slot) || 0;
  const distance = Number(s.sync_distance) || 0;
  const total = head + distance;
  let pct = total > 0 ? Math.floor((head * 10000) / total) / 100 : 0;
  if (s.is_syncing && pct >= 100) pct = 99.99;
  return pct.toFixed(2);
}

/** Health in plain words (spec §4): Synced, Syncing n%, Not ready. */
export function describeHealth(status: NodeStatus | undefined): { tone: StatusTone; label: string } {
  if (!status) return { tone: "neutral", label: "Checking" };
  if (status.health === "not_ready") return { tone: "danger", label: "Not ready" };
  const s = status.syncing;
  if (status.health === "syncing" || s?.is_syncing) {
    return { tone: "warning", label: s ? `Syncing ${syncPercent(s)}%` : "Syncing" };
  }
  return { tone: "success", label: "Synced" };
}
