import { isClientUnavailable } from "../errors";
import { createMockApi, MOCK_BEACON_VALIDATORS, MOCK_DEFAULT_FEE_RECIPIENT, MOCK_OVERRIDE_FEE_RECIPIENT, MOCK_PUBKEYS } from "../mock";

const keystoreJson = (pubkey: string) => JSON.stringify({ crypto: {}, pubkey: pubkey.slice(2), path: "m/12381/3600/0/0/0", version: 4 });

describe("mock API", () => {
  it("lists five keys covering 0x00, 0x01, 0x02, a pending one and one unknown to the beacon node", async () => {
    const api = createMockApi();
    const keys = (await api.keymanager.listKeystores()).map((k) => k.validating_pubkey);
    expect(keys).toHaveLength(5);
    const states = await Promise.all(keys.map((k) => api.beacon.validator(k)));
    const prefixes = states.filter(Boolean).map((s) => s!.validator.withdrawal_credentials.slice(0, 4));
    expect(new Set(prefixes)).toEqual(new Set(["0x00", "0x01", "0x02"]));
    expect(states.some((s) => s?.status === "pending_queued")).toBe(true);
    expect(await api.beacon.validator(MOCK_PUBKEYS.unknown)).toBeNull();
    for (const s of MOCK_BEACON_VALIDATORS) expect(s.validator.pubkey).toMatch(/^0x[0-9a-f]{96}$/);
  });

  it("settings follow the Nimbus schema and saves are full-object overwrites", async () => {
    const api = createMockApi();
    const s = await api.backend.getSettings();
    for (const k of [
      "network",
      "ee_endpoint",
      "execution_engine",
      "validators_graffiti",
      "p2p_peer_lower_bound",
      "p2p_peer_upper_bound",
      "validators_proposer_default_fee_recipient",
      "initial_state",
      "mev_boost",
    ])
      expect(s).toHaveProperty(k);
    await api.backend.saveSettings({ ...s, validators_graffiti: "hi", future_field: 1 });
    expect(await api.backend.getSettings()).toEqual({ ...s, validators_graffiti: "hi", future_field: 1 });
    await api.backend.saveSettings({ network: "mainnet" });
    expect(await api.backend.getSettings()).toEqual({ network: "mainnet" });
  });

  it("returns copies, so callers can't mutate mock state", async () => {
    const api = createMockApi();
    const s = await api.backend.getSettings();
    s.validators_graffiti = "mutated";
    expect((await api.backend.getSettings()).validators_graffiti).not.toBe("mutated");
  });

  it("fee recipients: override, default fallback, clear", async () => {
    const api = createMockApi();
    expect(await api.keymanager.getFeeRecipient(MOCK_PUBKEYS.active02)).toBe(MOCK_OVERRIDE_FEE_RECIPIENT);
    expect(await api.keymanager.getFeeRecipient(MOCK_PUBKEYS.active01)).toBe(MOCK_DEFAULT_FEE_RECIPIENT);
    await api.keymanager.deleteFeeRecipient(MOCK_PUBKEYS.active02);
    expect(await api.keymanager.getFeeRecipient(MOCK_PUBKEYS.active02)).toBe(MOCK_DEFAULT_FEE_RECIPIENT);
    await expect(api.keymanager.setFeeRecipient(MOCK_PUBKEYS.active01, "0x123")).rejects.toThrow();
  });

  it("getFeeRecipient is null (not \"\") when there is no override and no default", async () => {
    const api = createMockApi({ settings: { validators_proposer_default_fee_recipient: "" } });
    expect(await api.keymanager.getFeeRecipient(MOCK_PUBKEYS.active01)).toBeNull();
    expect(await api.keymanager.getFeeRecipient(MOCK_PUBKEYS.active02)).toBe(MOCK_OVERRIDE_FEE_RECIPIENT);
  });

  it("import returns per-file results and keeps the successes", async () => {
    const api = createMockApi();
    const fresh = `0x${"ab".repeat(48)}`;
    const other = `0x${"cd".repeat(48)}`;
    const res = await api.keymanager.importKeystores({
      keystores: [keystoreJson(fresh), keystoreJson(MOCK_PUBKEYS.active01), keystoreJson(other), "not json"],
      passwords: ["pw", "pw", "wrong", "pw"],
    });
    expect(res.map((r) => r.status)).toEqual(["imported", "duplicate", "error", "error"]);
    const keys = (await api.keymanager.listKeystores()).map((k) => k.validating_pubkey);
    expect(keys).toContain(fresh);
    expect(keys).not.toContain(other);
  });

  it("delete returns slashing protection for the removed keys", async () => {
    const api = createMockApi();
    const res = await api.keymanager.deleteKeystores([MOCK_PUBKEYS.active01, `0x${"ee".repeat(48)}`]);
    expect(res.data.map((d) => d.status)).toEqual(["deleted", "not_found"]);
    expect(typeof res.slashing_protection).toBe("string");
    const interchange = JSON.parse(res.slashing_protection as string);
    expect(interchange.metadata.interchange_format_version).toBe("5");
    expect(interchange.data[0].pubkey).toBe(MOCK_PUBKEYS.active01);
    expect((await api.keymanager.listKeystores()).map((k) => k.validating_pubkey)).not.toContain(MOCK_PUBKEYS.active01);
  });

  it("voluntary exit: sign through keymanager, submit through beacon", async () => {
    const api = createMockApi();
    const signed = await api.keymanager.signVoluntaryExit(MOCK_PUBKEYS.active01);
    expect(signed.message.validator_index).toBe("412345");
    await api.beacon.submitVoluntaryExit(signed);
    expect((await api.beacon.validator(MOCK_PUBKEYS.active01))!.status).toBe("active_exiting");
    await expect(api.keymanager.signVoluntaryExit(MOCK_PUBKEYS.unknown)).rejects.toThrow();
  });

  it("stopping the service makes the beacon and keymanager unreachable until it starts", async () => {
    const api = createMockApi();
    await api.backend.service("stop");
    expect(await api.beacon.health()).toBe("not_ready");
    await expect(api.keymanager.listKeystores()).rejects.toMatchObject({ kind: "upstream", service: "keymanager" });
    await expect(api.beacon.syncing()).rejects.toMatchObject({ kind: "upstream", service: "beacon" });
    expect(isClientUnavailable(await api.keymanager.listKeystores().catch((e) => e))).toBe(true);
    expect((await api.backend.serviceStatus()).find((p) => p.name === "nimbus")!.statename).toBe("STOPPED");
    await api.backend.service("start");
    expect(await api.beacon.health()).toBe("ready");
    expect((await api.backend.serviceStatus()).find((p) => p.name === "nimbus")!.statename).toBe("RUNNING");
  });

  it("node status, packages and logs", async () => {
    const api = createMockApi();
    expect((await api.beacon.syncing()).is_syncing).toBe(false);
    const peers = await api.beacon.peers();
    expect(Number((await api.beacon.peerCount()).connected)).toBe(peers.length);
    expect(peers.some((p) => p.direction === "inbound")).toBe(true);
    expect(await api.beacon.version()).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(await api.dappmanager.listPackages()).toContain("mevboost.avado.dnp.dappnode.eth");
    expect((await api.dappmanager.logs("nimbus.avado.dnp.dappnode.eth", 20)).split("\n")).toHaveLength(20);
  });

  it("lists stopped packages as installed, with running false", async () => {
    const api = createMockApi({ stoppedPackages: ["ethchain-geth.public.dappnode.eth"] });
    expect(await api.dappmanager.listPackages()).toContain("ethchain-geth.public.dappnode.eth");
    const states = await api.dappmanager.listPackageStates();
    expect(states.find((p) => p.name === "ethchain-geth.public.dappnode.eth")).toEqual({ name: "ethchain-geth.public.dappnode.eth", running: false });
    expect(states.find((p) => p.name === "mevboost.avado.dnp.dappnode.eth")?.running).toBe(true);
  });

  it("accepts overrides for other scenarios", async () => {
    const api = createMockApi({ keystores: [], packages: [], health: "syncing" });
    expect(await api.keymanager.listKeystores()).toEqual([]);
    expect(await api.dappmanager.listPackages()).toEqual([]);
    expect(await api.beacon.health()).toBe("syncing");
  });
});
