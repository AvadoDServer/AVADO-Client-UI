/**
 * In-memory implementations of the adapter interfaces, for `VITE_MOCK=1
 * yarn dev` and for tests. State is shared across the four adapters of one
 * `createMockApi()` call, so importing a key shows up in `listKeystores()`,
 * saving settings shows up in `getSettings()`, and so on.
 *
 * Mock-only conventions:
 *  - importKeystores: a password of "" or "wrong" gives an error result.
 *  - pubkeys not in `beaconValidators` return `null` (a beacon 404).
 */
import type {
  Api,
  BeaconApi,
  DappManager,
  DeleteKeystoresResponse,
  ImportKeystoresRequest,
  ImportResult,
  Keystore,
  KeymanagerApi,
  NodeHealth,
  PackageBackend,
  Peer,
  ProcessInfo,
  ServiceAction,
  Settings,
  SignedVoluntaryExit,
  SyncingStatus,
  ValidatorState,
} from "./types";
import { ApiError } from "./errors";

/** Deterministic fake hex of `bytes` bytes, so mock keys look real but stay stable. */
export function fakeHex(seed: number, bytes: number): string {
  let x = (seed * 2654435761) >>> 0 || 1;
  let out = "0x";
  for (let i = 0; i < bytes; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out += (x & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}

const pk = (n: number) => fakeHex(n, 48);
const addr = (n: number) => fakeHex(1000 + n, 20);

export const MOCK_DEFAULT_FEE_RECIPIENT = addr(1);
export const MOCK_OVERRIDE_FEE_RECIPIENT = addr(2);

/** Nimbus mainnet defaults (build/server/settings/defaultsettings-mainnet.json). */
export const MOCK_DEFAULT_SETTINGS: Settings = {
  network: "mainnet",
  ee_endpoint: "http://ethchain-geth.my.ava.do:8551",
  execution_engine: "ethchain-geth.public.dappnode.eth",
  validators_graffiti: "Avado",
  p2p_peer_lower_bound: 64,
  p2p_peer_upper_bound: 100,
  validators_proposer_default_fee_recipient: "",
  initial_state: "https://sync-mainnet.beaconcha.in",
  mev_boost: false,
};

/** A configured owner: fee recipient set, MEV-Boost on, custom graffiti. */
export const MOCK_SETTINGS: Settings = {
  ...MOCK_DEFAULT_SETTINGS,
  validators_graffiti: "My AVADO",
  validators_proposer_default_fee_recipient: MOCK_DEFAULT_FEE_RECIPIENT,
  mev_boost: true,
};

const credsFor = (prefix: "00" | "01" | "02", n: number) =>
  prefix === "00" ? `0x00${fakeHex(2000 + n, 31).slice(2)}` : `0x${prefix}${"00".repeat(11)}${addr(n).slice(2)}`;

function validatorState(
  n: number,
  index: number,
  status: ValidatorState["status"],
  creds: "00" | "01" | "02",
  balanceGwei: string,
  effectiveGwei: string,
  activation = "180321",
): ValidatorState {
  const FAR = "18446744073709551615";
  const pending = status.startsWith("pending");
  return {
    index: String(index),
    balance: balanceGwei,
    status,
    validator: {
      pubkey: pk(n),
      withdrawal_credentials: credsFor(creds, n),
      effective_balance: effectiveGwei,
      slashed: false,
      activation_eligibility_epoch: pending ? "391204" : "179870",
      activation_epoch: pending ? FAR : activation,
      exit_epoch: FAR,
      withdrawable_epoch: FAR,
    },
  };
}

/** The mock box's validators, one per interesting state. */
export const MOCK_PUBKEYS = {
  active01: pk(1),
  active02: pk(2),
  active00: pk(3),
  pendingQueued: pk(4),
  unknown: pk(5),
} as const;

export const MOCK_BEACON_VALIDATORS: ValidatorState[] = [
  // Active, 0x01 withdrawal address, default fee recipient.
  validatorState(1, 412345, "active_ongoing", "01", "32013456789", "32000000000"),
  // Active, compounding 0x02, fee-recipient override, grown balance.
  validatorState(2, 1203311, "active_ongoing", "02", "64210987654", "64000000000", "301144"),
  // Active, old 0x00 BLS credentials — needs a withdrawal address.
  validatorState(3, 98765, "active_ongoing", "00", "32001234567", "32000000000", "12001"),
  // Deposit seen, waiting in the activation queue.
  validatorState(4, 1987654, "pending_queued", "01", "32000000000", "32000000000"),
  // MOCK_PUBKEYS.unknown is imported but the beacon node doesn't know it yet.
];

export interface MockOptions {
  settings?: Settings;
  defaultSettings?: Settings;
  keystores?: string[];
  beaconValidators?: ValidatorState[];
  /** Fee-recipient overrides by pubkey. */
  feeRecipients?: Record<string, string>;
  packages?: string[];
  health?: NodeHealth;
  syncing?: SyncingStatus;
  peers?: Peer[];
  version?: string;
  /** Artificial latency per call; 0 in tests. */
  latencyMs?: number;
}

export const MOCK_PACKAGES = [
  "dappmanager.dnp.dappnode.eth",
  "ethchain-geth.public.dappnode.eth",
  "nimbus.avado.dnp.dappnode.eth",
  "mevboost.avado.dnp.dappnode.eth",
];

function mockPeers(): Peer[] {
  return Array.from({ length: 78 }, (_, i) => ({
    peer_id: `16Uiu2HAm${fakeHex(3000 + i, 20).slice(2, 44)}`,
    last_seen_p2p_address: `/ip4/10.${i % 250}.${(i * 7) % 250}.${(i * 13) % 250}/tcp/9000`,
    state: "connected" as const,
    direction: (i % 3 === 0 ? "inbound" : "outbound") as Peer["direction"],
  }));
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function pubkeyFromKeystore(json: string): string | null {
  try {
    const k = JSON.parse(json) as { pubkey?: unknown };
    if (typeof k.pubkey !== "string" || !/^(0x)?[0-9a-fA-F]{96}$/.test(k.pubkey)) return null;
    return (k.pubkey.startsWith("0x") ? k.pubkey : `0x${k.pubkey}`).toLowerCase();
  } catch {
    return null;
  }
}

function slashingInterchange(pubkeys: string[]): string {
  return JSON.stringify({
    metadata: {
      interchange_format_version: "5",
      genesis_validators_root: "0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95",
    },
    data: pubkeys.map((p) => ({
      pubkey: p,
      signed_blocks: [{ slot: "9876543" }],
      signed_attestations: [{ source_epoch: "308641", target_epoch: "308642" }],
    })),
  });
}

const ANSI = { dim: "\u001b[2m", green: "\u001b[32m", yellow: "\u001b[33m", reset: "\u001b[0m" };

export function createMockApi(opts: MockOptions = {}): Api {
  const latency = opts.latencyMs ?? 0;
  const wait = () => (latency > 0 ? new Promise<void>((r) => setTimeout(r, latency)) : Promise.resolve());

  const state = {
    settings: clone(opts.settings ?? MOCK_SETTINGS),
    defaultSettings: clone(opts.defaultSettings ?? MOCK_DEFAULT_SETTINGS),
    keystores: [...(opts.keystores ?? Object.values(MOCK_PUBKEYS))],
    beacon: new Map((opts.beaconValidators ?? MOCK_BEACON_VALIDATORS).map((v) => [v.validator.pubkey, clone(v)])),
    feeRecipients: { ...(opts.feeRecipients ?? { [MOCK_PUBKEYS.active02]: MOCK_OVERRIDE_FEE_RECIPIENT }) } as Record<string, string>,
    packages: [...(opts.packages ?? MOCK_PACKAGES)],
    health: opts.health ?? ("ready" as NodeHealth),
    syncing: opts.syncing ?? { head_slot: "12634567", sync_distance: "0", is_syncing: false, is_optimistic: false, el_offline: false },
    peers: opts.peers ?? mockPeers(),
    version: opts.version ?? "v26.8.0",
    running: true,
    startedAt: Math.floor(Date.now() / 1000) - 3 * 86400,
    exits: [] as SignedVoluntaryExit[],
  };

  const processes = (): ProcessInfo[] => {
    const now = Math.floor(Date.now() / 1000);
    const up = (name: string, pid: number, start: number): ProcessInfo => ({
      name,
      group: name,
      statename: "RUNNING",
      state: 20,
      description: `pid ${pid}, uptime ${Math.floor((now - start) / 86400)} days`,
      pid,
      start,
      now,
      stop: 0,
      exitstatus: 0,
      spawnerr: "",
    });
    const client = state.running
      ? up("nimbus", 41, state.startedAt)
      : { name: "nimbus", group: "nimbus", statename: "STOPPED", state: 0, description: "Not started", pid: 0, start: state.startedAt, stop: now, now, exitstatus: 0, spawnerr: "" };
    return [client, up("server", 12, state.startedAt - 5), up("wizard", 13, state.startedAt - 5)];
  };

  const backend: PackageBackend = {
    async getSettings() {
      await wait();
      return clone(state.settings);
    },
    async saveSettings(s) {
      await wait();
      state.settings = clone(s); // full overwrite, like the real backend
      state.startedAt = Math.floor(Date.now() / 1000);
    },
    async getDefaultSettings() {
      await wait();
      return clone(state.defaultSettings);
    },
    async service(action: ServiceAction) {
      await wait();
      if (action === "stop") state.running = false;
      else {
        state.running = true;
        state.startedAt = Math.floor(Date.now() / 1000);
      }
    },
    async serviceStatus() {
      await wait();
      return processes();
    },
  };

  /** Like the real proxies while the client is stopped: an `upstream` ApiError. */
  const notRunning = (service: "beacon" | "keymanager") => {
    if (!state.running) throw new ApiError({ kind: "upstream", service, status: 500, detail: "The client is not running" });
  };

  const beacon: BeaconApi = {
    async health() {
      await wait();
      return state.running ? state.health : "not_ready";
    },
    async syncing() {
      await wait();
      notRunning("beacon");
      return clone(state.syncing);
    },
    async peerCount() {
      await wait();
      notRunning("beacon");
      return { connected: String(state.peers.length), disconnected: "12", connecting: "0", disconnecting: "0" };
    },
    async peers() {
      await wait();
      notRunning("beacon");
      return clone(state.peers);
    },
    async version() {
      await wait();
      notRunning("beacon");
      return state.version;
    },
    async validator(pubkey) {
      await wait();
      notRunning("beacon");
      const v = state.beacon.get(pubkey.toLowerCase());
      return v ? clone(v) : null;
    },
    async submitVoluntaryExit(msg) {
      await wait();
      notRunning("beacon");
      state.exits.push(clone(msg));
      const v = [...state.beacon.values()].find((x) => x.index === msg.message.validator_index);
      if (!v) throw new Error(`Validator ${msg.message.validator_index} not found`);
      v.status = "active_exiting";
      v.validator.exit_epoch = String(Number(msg.message.epoch) + 5);
    },
  };

  const keymanager: KeymanagerApi = {
    async listKeystores(): Promise<Keystore[]> {
      await wait();
      notRunning("keymanager");
      return state.keystores.map((p) => ({ validating_pubkey: p, derivation_path: "", readonly: false }));
    },
    async importKeystores(req: ImportKeystoresRequest): Promise<ImportResult[]> {
      await wait();
      notRunning("keymanager");
      if (req.keystores.length !== req.passwords.length) throw new Error("keystores and passwords differ in length");
      return req.keystores.map((json, i) => {
        const p = pubkeyFromKeystore(json);
        if (!p) return { status: "error", message: "Not a valid keystore file" };
        const pw = req.passwords[i];
        if (!pw || pw === "wrong") return { status: "error", message: "Invalid password" };
        if (state.keystores.includes(p)) return { status: "duplicate" };
        state.keystores.push(p);
        return { status: "imported" };
      });
    },
    async deleteKeystores(pubkeys: string[]): Promise<DeleteKeystoresResponse> {
      await wait();
      notRunning("keymanager");
      const data = pubkeys.map((p) => {
        const i = state.keystores.indexOf(p.toLowerCase());
        if (i < 0) return { status: "not_found" as const };
        state.keystores.splice(i, 1);
        delete state.feeRecipients[p.toLowerCase()];
        return { status: "deleted" as const };
      });
      return { data, slashing_protection: slashingInterchange(pubkeys) };
    },
    async getFeeRecipient(pubkey) {
      await wait();
      notRunning("keymanager");
      const p = pubkey.toLowerCase();
      if (!state.keystores.includes(p)) return null;
      // No override and no default: nothing to report (like a keymanager 404).
      return state.feeRecipients[p] || state.settings.validators_proposer_default_fee_recipient || null;
    },
    async setFeeRecipient(pubkey, ethaddress) {
      await wait();
      notRunning("keymanager");
      if (!/^0x[a-fA-F0-9]{40}$/.test(ethaddress)) throw new Error("Invalid address");
      state.feeRecipients[pubkey.toLowerCase()] = ethaddress;
    },
    async deleteFeeRecipient(pubkey) {
      await wait();
      notRunning("keymanager");
      delete state.feeRecipients[pubkey.toLowerCase()];
    },
    async signVoluntaryExit(pubkey, epoch) {
      await wait();
      notRunning("keymanager");
      const v = state.beacon.get(pubkey.toLowerCase());
      if (!v) throw new Error("The beacon node does not know this validator yet");
      return {
        message: { epoch: epoch ?? String(Math.floor(Number(state.syncing.head_slot) / 32)), validator_index: v.index },
        signature: fakeHex(4000 + Number(v.index), 96),
      };
    },
  };

  const dappmanager: DappManager = {
    async listPackages() {
      await wait();
      return [...state.packages];
    },
    async logs(_pkg, tail) {
      await wait();
      const now = Date.now();
      const lines = Array.from({ length: Math.max(0, tail) }, (_, i) => {
        const t = new Date(now - (tail - i) * 6000).toISOString().replace("T", " ").slice(0, 23);
        const slot = Number(state.syncing.head_slot) - (tail - i);
        return i % 7 === 3
          ? `${ANSI.yellow}WRN${ANSI.reset} ${ANSI.dim}${t}${ANSI.reset} Peer count low                              topics="networking" peers=${state.peers.length}`
          : `${ANSI.green}INF${ANSI.reset} ${ANSI.dim}${t}${ANSI.reset} Slot end                                    slot=${slot} head=${fakeHex(slot, 4).slice(2)}:${slot} finalized=${Math.floor(slot / 32) - 2}`;
      });
      return lines.join("\n");
    },
  };

  return { backend, beacon, keymanager, dappmanager };
}
