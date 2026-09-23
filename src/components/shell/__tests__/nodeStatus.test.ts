import { ApiError } from "../../../api/errors";
import { createMockApi } from "../../../api/mock";
import type { BeaconApi, SyncingStatus } from "../../../api/types";
import type { ProcessInfo } from "../../../api/types";
import { clientServiceState, describeHealth, fetchNodeStatus, syncPercent } from "../nodeStatus";

const proc = (name: string, statename: string): ProcessInfo => ({ name, statename });

const syncing = (head: number, distance: number, is_syncing = distance > 0): SyncingStatus => ({
  head_slot: String(head),
  sync_distance: String(distance),
  is_syncing,
});

describe("syncPercent", () => {
  it("is head / (head + distance), rounded down to two decimals", () => {
    expect(syncPercent(syncing(9712, 288))).toBe("97.12");
    expect(syncPercent(syncing(99999, 1))).toBe("99.99");
    expect(syncPercent(syncing(0, 1000))).toBe("0.00");
  });
  it("never shows 100% while still syncing", () => {
    expect(syncPercent(syncing(1000000, 0, true))).toBe("99.99");
  });
});

describe("describeHealth", () => {
  it("says Checking before the first answer", () => {
    expect(describeHealth(undefined)).toEqual({ tone: "neutral", label: "Checking" });
  });
  it("says Not ready when the node is not ready", () => {
    expect(describeHealth({ health: "not_ready" })).toEqual({ tone: "danger", label: "Not ready" });
  });
  it("says Stopped or Starting when the process state is known", () => {
    expect(describeHealth({ health: "not_ready", service: "stopped" })).toEqual({ tone: "danger", label: "Stopped" });
    expect(describeHealth({ health: "not_ready", service: "starting" })).toEqual({ tone: "warning", label: "Starting" });
  });
  it("says Syncing with the percentage", () => {
    expect(describeHealth({ health: "syncing", syncing: syncing(9712, 288) })).toEqual({ tone: "warning", label: "Syncing 97.12%" });
  });
  it("says Syncing without a percentage when there is no sync data", () => {
    expect(describeHealth({ health: "syncing" })).toEqual({ tone: "warning", label: "Syncing" });
  });
  it("says Synced when ready and not syncing", () => {
    expect(describeHealth({ health: "ready", syncing: syncing(100, 0) })).toEqual({ tone: "success", label: "Synced" });
  });
  it("does not say a plain green Synced while the execution client is offline", () => {
    expect(describeHealth({ health: "ready", syncing: { ...syncing(100, 0), el_offline: true }, elOffline: true })).toEqual({
      tone: "warning",
      label: "Synced, execution client offline",
    });
  });
  it("says Can't connect when nothing on the box answers", () => {
    expect(describeHealth({ health: "not_ready", unreachable: true })).toEqual({ tone: "danger", label: "Can't connect" });
  });
  it("trusts is_syncing over a ready health answer", () => {
    expect(describeHealth({ health: "ready", syncing: syncing(50, 50) }).label).toBe("Syncing 50.00%");
  });
});

describe("clientServiceState", () => {
  it("reads the client's own process", () => {
    expect(clientServiceState([proc("nimbus", "STOPPED"), proc("server", "RUNNING")], "nimbus")).toBe("stopped");
    expect(clientServiceState([proc("nimbus", "RUNNING"), proc("server", "RUNNING")], "nimbus")).toBe("starting");
    expect(clientServiceState([proc("nimbus", "STARTING")], "nimbus")).toBe("starting");
    expect(clientServiceState([proc("nimbus", "BACKOFF")], "nimbus")).toBe("starting");
    expect(clientServiceState([proc("nimbus", "EXITED")], "nimbus")).toBe("stopped");
    expect(clientServiceState([proc("nimbus", "FATAL")], "nimbus")).toBe("stopped");
  });
  it("falls back to the one process that isn't the package's own server", () => {
    expect(clientServiceState([proc("teku-beacon", "STOPPED"), proc("monitor", "RUNNING")], "teku")).toBe("stopped");
  });
  it("is unknown when it can't tell", () => {
    expect(clientServiceState([], "nimbus")).toBeUndefined();
    expect(clientServiceState([proc("a", "STOPPED"), proc("b", "RUNNING")], "nimbus")).toBeUndefined();
    expect(clientServiceState([proc("nimbus", "UNKNOWN")], "nimbus")).toBeUndefined();
  });
});

describe("fetchNodeStatus", () => {
  it("when not ready, asks supervisord whether the client is stopped or starting", async () => {
    const api = createMockApi({ latencyMs: 0 });
    await api.backend.service("stop");
    expect(await fetchNodeStatus(api.beacon, false, { client: "nimbus", serviceStatus: api.backend.serviceStatus })).toEqual({
      health: "not_ready",
      service: "stopped",
    });
  });

  it("when not ready and supervisord can't be read, says nothing about the process", async () => {
    const api = createMockApi({ latencyMs: 0, health: "not_ready" });
    vi.spyOn(api.backend, "serviceStatus").mockRejectedValue(new Error("down"));
    expect(await fetchNodeStatus(api.beacon, false, { client: "nimbus", serviceStatus: api.backend.serviceStatus })).toEqual({
      health: "not_ready",
    });
  });

  it("reads health, sync, peers and version (simple)", async () => {
    const api = createMockApi({ latencyMs: 0 });
    const peers = vi.spyOn(api.beacon, "peers");
    const s = await fetchNodeStatus(api.beacon, false);
    expect(s).toMatchObject({ health: "ready", peers: 78, version: "v26.8.0", elOffline: false });
    expect(s.syncing?.head_slot).toBe("12634567");
    expect(s.inbound).toBeUndefined();
    expect(peers).not.toHaveBeenCalled();
  });

  it("adds inbound and outbound connected peers in Advanced", async () => {
    const api = createMockApi({ latencyMs: 0 });
    const s = await fetchNodeStatus(api.beacon, true);
    expect(s.inbound).toBe(26);
    expect(s.outbound).toBe(52);
  });

  it("stops at not_ready without asking for the rest", async () => {
    const api = createMockApi({ latencyMs: 0, health: "not_ready" });
    const sync = vi.spyOn(api.beacon, "syncing");
    expect(await fetchNodeStatus(api.beacon, true)).toEqual({ health: "not_ready" });
    expect(sync).not.toHaveBeenCalled();
  });

  it("treats a failing health call as not ready", async () => {
    const beacon = { health: () => Promise.reject(new Error("down")) } as unknown as BeaconApi;
    expect(await fetchNodeStatus(beacon, false)).toEqual({ health: "not_ready" });
  });

  it("marks el_offline from /eth/v1/node/syncing", async () => {
    const api = createMockApi({ latencyMs: 0, syncing: { ...syncing(100, 0), el_offline: true } });
    expect(await fetchNodeStatus(api.beacon, false)).toMatchObject({ health: "ready", elOffline: true });
  });

  describe("nothing reachable", () => {
    const unreachable = (path: string) => new ApiError({ kind: "unreachable", service: "beacon", path });
    const deadBeacon = { health: () => Promise.reject(unreachable("/eth/v1/node/health")) } as unknown as BeaconApi;

    it("is unreachable when the backend gives no answer to health nor to the service probe", async () => {
      const probe = { client: "nimbus" as const, serviceStatus: () => Promise.reject(new ApiError({ kind: "unreachable", service: "backend" })) };
      expect(await fetchNodeStatus(deadBeacon, false, probe)).toEqual({ health: "not_ready", unreachable: true });
    });

    it("a timeout counts as no answer too", async () => {
      const beacon = { health: () => Promise.reject(new ApiError({ kind: "timeout", service: "beacon" })) } as unknown as BeaconApi;
      expect(await fetchNodeStatus(beacon, false)).toEqual({ health: "not_ready", unreachable: true });
    });

    it("is not unreachable when supervisord answers", async () => {
      const probe = { client: "nimbus" as const, serviceStatus: async () => [proc("nimbus", "STOPPED")] };
      expect(await fetchNodeStatus(deadBeacon, false, probe)).toEqual({ health: "not_ready", service: "stopped" });
    });

    it("is not unreachable when the proxy answered (client down behind it)", async () => {
      const api = createMockApi({ latencyMs: 0, health: "not_ready" });
      const probe = { client: "nimbus" as const, serviceStatus: () => Promise.reject(new Error("down")) };
      expect((await fetchNodeStatus(api.beacon, false, probe)).unreachable).toBeUndefined();
    });
  });

  it("keeps what it got when one of the calls fails", async () => {
    const api = createMockApi({ latencyMs: 0 });
    vi.spyOn(api.beacon, "version").mockRejectedValue(new Error("nope"));
    const s = await fetchNodeStatus(api.beacon, false);
    expect(s.version).toBeUndefined();
    expect(s.peers).toBe(78);
  });
});
