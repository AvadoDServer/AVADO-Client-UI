import { isApiError } from "../../api/errors";
import type { BeaconApi, NodeHealth, ProcessInfo, SyncingStatus } from "../../api/types";
import type { ClientName } from "../../config/clientConfig";
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
  /**
   * The beacon node follows the chain optimistically: its execution client
   * hasn't verified the latest blocks yet (still catching up).
   */
  optimistic?: boolean;
  /** When not ready: what supervisord says about the client process, if known. */
  service?: ServiceState;
  /**
   * When not ready: nothing answered at all — neither the package backend's
   * `/rest` proxy nor its `/service/status`. The box is off or off the
   * network, the package is down, or the browser can't reach it.
   */
  unreachable?: boolean;
}

export type ServiceState = "stopped" | "starting";

/** The package's own helper processes, never the client itself. */
const HELPER_PROCESSES = new Set(["server", "wizard", "monitor", "nginx"]);
const STOPPED = new Set(["STOPPED", "EXITED", "FATAL"]);
const STARTING = new Set(["RUNNING", "STARTING", "BACKOFF"]);

/**
 * The supervisord program that serves the beacon API, when it isn't named
 * after the client. Lighthouse runs its beacon node and validator client as
 * two programs (`lighthouse-bn`, `lighthouse-vc`); the status strip follows
 * the beacon node.
 */
const BEACON_PROCESS: Partial<Record<ClientName, string>> = {
  lighthouse: "lighthouse-bn",
};

/**
 * The client process's state from supervisord: the client's beacon-node
 * process (named after the client unless `BEACON_PROCESS` says otherwise),
 * else the only process that isn't a helper. "starting" covers a running
 * process whose beacon API isn't up yet. Undefined when unclear.
 */
export function clientServiceState(processes: ProcessInfo[], client: ClientName): ServiceState | undefined {
  const own = processes.find((p) => p.name === (BEACON_PROCESS[client] ?? client));
  const others = processes.filter((p) => !HELPER_PROCESSES.has(p.name));
  const proc = own ?? (others.length === 1 ? others[0] : undefined);
  if (!proc) return undefined;
  if (STOPPED.has(proc.statename)) return "stopped";
  if (STARTING.has(proc.statename)) return "starting";
  return undefined;
}

export interface ServiceProbe {
  client: ClientName;
  serviceStatus: () => Promise<ProcessInfo[]>;
}

const settled = <T,>(r: PromiseSettledResult<T>): T | undefined => (r.status === "fulfilled" ? r.value : undefined);

/**
 * One status read. Health first: a node that is not ready answers nothing
 * else, so the rest is skipped. The other calls run together and each may
 * fail on its own.
 */
export async function fetchNodeStatus(beacon: BeaconApi, advanced: boolean, probe?: ServiceProbe): Promise<NodeStatus> {
  let health: NodeHealth;
  // The health call accepts any HTTP answer (a proxy 500 while the client is
  // down is "not_ready"), so it only throws when the package backend itself
  // gave no answer.
  let backendSilent = false;
  try {
    health = await beacon.health();
  } catch (e) {
    health = "not_ready";
    backendSilent = isApiError(e) && (e.kind === "unreachable" || e.kind === "timeout");
  }
  if (health === "not_ready") {
    const status: NodeStatus = { health };
    let probeFailed = !probe;
    if (probe) {
      try {
        const service = clientServiceState(await probe.serviceStatus(), probe.client);
        if (service) status.service = service;
      } catch {
        /* backend unreachable: say nothing about the process */
        probeFailed = true;
      }
    }
    if (backendSilent && probeFailed) status.unreachable = true;
    return status;
  }

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
    status.optimistic = s.is_optimistic === true;
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

/**
 * What the shell knows about the execution client beyond the beacon node's
 * own answer: none installed, installed but stopped, or catching up (seen
 * over more than one poll, so a slow block doesn't flicker the strip).
 */
export type ExecutionState = "missing" | "stopped" | "catching-up";

/**
 * Health in plain words (spec §4): Synced, Syncing n%, Not ready (Stopped or
 * Starting when known, Can't connect when nothing answers). Synced with the
 * execution client missing, stopped, offline or catching up is a warning:
 * validators can't do all their duties.
 */
export function describeHealth(
  status: NodeStatus | undefined,
  execution?: ExecutionState,
): { tone: StatusTone; label: string } {
  if (!status) return { tone: "neutral", label: "Checking" };
  if (status.health === "not_ready") {
    if (status.unreachable) return { tone: "danger", label: "Can't connect" };
    if (status.service === "stopped") return { tone: "danger", label: "Stopped" };
    if (status.service === "starting") return { tone: "warning", label: "Starting" };
    return { tone: "danger", label: "Not ready" };
  }
  const s = status.syncing;
  if (status.health === "syncing" || s?.is_syncing) {
    return { tone: "warning", label: s ? `Syncing ${syncPercent(s)}%` : "Syncing" };
  }
  if (execution === "missing") return { tone: "warning", label: "Synced, no execution client" };
  if (execution === "stopped") return { tone: "warning", label: "Synced, execution client stopped" };
  if (status.elOffline) return { tone: "warning", label: "Synced, execution client offline" };
  if (execution === "catching-up") return { tone: "warning", label: "Synced, execution client catching up" };
  return { tone: "success", label: "Synced" };
}
