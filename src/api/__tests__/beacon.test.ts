import { createBeaconApi, shortVersion } from "../beacon";
import { createFetchMock, networkDown } from "./fetchMock";

const API = "http://nimbus.my.ava.do:9999";
const REST = `${API}/rest`;
const PK = `0x${"ab".repeat(48)}`;

const make = (m: ReturnType<typeof createFetchMock>) => createBeaconApi({ apiUrl: API }, { fetch: m.fetch });

describe("createBeaconApi", () => {
  it.each([
    [200, "ready"],
    [206, "syncing"],
    [503, "not_ready"],
    [500, "not_ready"],
  ] as const)("health maps HTTP %i to %s", async (status, health) => {
    const m = createFetchMock().on("GET", `${REST}/eth/v1/node/health`, { status, text: "" });
    expect(await make(m).health()).toBe(health);
  });

  it("health: the client behind the proxy being down is not_ready", async () => {
    const m = createFetchMock().on("GET", `${REST}/eth/v1/node/health`, { status: 500, json: { error: "Connection refused" } });
    expect(await make(m).health()).toBe("not_ready");
  });

  it("health: the package backend being down is an 'unreachable' error", async () => {
    const m = createFetchMock().on("GET", `${REST}/eth/v1/node/health`, networkDown());
    await expect(make(m).health()).rejects.toMatchObject({ kind: "unreachable", service: "beacon" });
  });

  it("syncing, peerCount and peers unwrap `data`", async () => {
    const syncing = { head_slot: "100", sync_distance: "0", is_syncing: false, is_optimistic: false, el_offline: false };
    const count = { connected: "80", disconnected: "3", connecting: "0", disconnecting: "0" };
    const peers = [{ peer_id: "16U", state: "connected", direction: "inbound" }];
    const m = createFetchMock()
      .on("GET", `${REST}/eth/v1/node/syncing`, { json: { data: syncing } })
      .on("GET", `${REST}/eth/v1/node/peer_count`, { json: { data: count, meta: {} } })
      .on("GET", `${REST}/eth/v1/node/peers`, { json: { data: peers, meta: { count: 1 } } });
    const beacon = make(m);
    expect(await beacon.syncing()).toEqual(syncing);
    expect(await beacon.peerCount()).toEqual(count);
    expect(await beacon.peers()).toEqual(peers);
  });

  it("rejects a response without `data`", async () => {
    const m = createFetchMock().on("GET", `${REST}/eth/v1/node/syncing`, { json: { nope: true } });
    await expect(make(m).syncing()).rejects.toMatchObject({ kind: "invalid", service: "beacon" });
  });

  it("version returns the short form", async () => {
    const m = createFetchMock().on("GET", `${REST}/eth/v1/node/version`, { json: { data: { version: "Nimbus/v26.8.0-1a2b3c-stateofus" } } });
    expect(await make(m).version()).toBe("v26.8.0");
  });

  it.each([
    ["Nimbus/v26.8.0-1a2b3c-stateofus", "v26.8.0"],
    ["teku/v24.10.3/linux-x86_64/-eclipseadoptium-openjdk64bitservervm-java-21", "v24.10.3"],
    ["Prysm/v5.1.2 (linux amd64)", "v5.1.2"],
    ["Lighthouse/v6.0.1-f5ad1ad/x86_64-linux", "v6.0.1"],
    ["SomeClient/unknown", "SomeClient/unknown"],
  ])("shortVersion(%s) = %s", (full, short) => {
    expect(shortVersion(full)).toBe(short);
  });

  it("validator returns the state, and null on 404 (not deposited yet)", async () => {
    const state = {
      index: "7",
      balance: "32000000000",
      status: "active_ongoing",
      validator: { pubkey: PK, withdrawal_credentials: "0x01", effective_balance: "32000000000", slashed: false },
    };
    const other = `0x${"cd".repeat(48)}`;
    const m = createFetchMock()
      .on("GET", `${REST}/eth/v1/beacon/states/head/validators/${PK}`, { json: { data: state, execution_optimistic: false } })
      .on("GET", `${REST}/eth/v1/beacon/states/head/validators/${other}`, { status: 404, json: { code: 404, message: "Could not find validator" } });
    const beacon = make(m);
    expect(await beacon.validator(PK)).toEqual(state);
    expect(await beacon.validator(other)).toBeNull();
  });

  it("validator: other errors still throw", async () => {
    const m = createFetchMock().on("GET", `${REST}/eth/v1/beacon/states/head/validators/${PK}`, { status: 500, json: { error: "Connection refused" } });
    await expect(make(m).validator(PK)).rejects.toMatchObject({ kind: "upstream" });
  });

  it("submitVoluntaryExit POSTs the signed message to the pool", async () => {
    const msg = { message: { epoch: "1", validator_index: "7" }, signature: "0xsig" };
    const m = createFetchMock().on("POST", `${REST}/eth/v1/beacon/pool/voluntary_exits`, { status: 200, text: "" });
    await make(m).submitVoluntaryExit(msg);
    expect(m.calls[0].body).toEqual(msg);
  });

  it("submitVoluntaryExit surfaces the beacon node's refusal", async () => {
    const msg = { message: { epoch: "1", validator_index: "7" }, signature: "0xsig" };
    const m = createFetchMock().on("POST", `${REST}/eth/v1/beacon/pool/voluntary_exits`, {
      status: 400,
      json: { code: 400, message: "Invalid voluntary exit: validator has not been active long enough" },
    });
    await expect(make(m).submitVoluntaryExit(msg)).rejects.toMatchObject({
      kind: "http",
      status: 400,
      detail: "Invalid voluntary exit: validator has not been active long enough",
    });
  });
});
