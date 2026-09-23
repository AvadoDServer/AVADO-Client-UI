import { createPackageBackend } from "../backend";
import { changedFields, saveSettingsMerged } from "../settings";
import type { PackageBackend, Settings } from "../types";
import { createFetchMock, networkDown } from "./fetchMock";

const API = "http://nimbus.my.ava.do:9999";

/** An older file: lacks mev_boost and initial_state, has a field this UI doesn't know. */
const ON_DISK: Settings = {
  network: "mainnet",
  ee_endpoint: "http://ethchain-geth.my.ava.do:8551",
  execution_engine: "ethchain-geth.public.dappnode.eth",
  validators_graffiti: "Avado",
  p2p_peer_lower_bound: 64,
  p2p_peer_upper_bound: 100,
  validators_proposer_default_fee_recipient: "0x1111111111111111111111111111111111111111",
  unknown_future_field: { keep: ["me"] },
  legacy_flag: false,
};

describe("saveSettingsMerged (spec §2.5 read-modify-write)", () => {
  it("GETs right before saving, changes only the patched fields, keeps unknown fields and POSTs the whole object", async () => {
    const m = createFetchMock()
      .on("GET", `${API}/settings`, { json: ON_DISK })
      .on("POST", `${API}/settings`, { text: "Saved settings and restarted" });
    const backend = createPackageBackend({ apiUrl: API, backend: "deno" }, { fetch: m.fetch });

    const saved = await saveSettingsMerged(backend, { validators_graffiti: "My node" });

    expect(m.calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${API}/settings`, `POST ${API}/settings`]);
    const posted = m.calls[1].body as Settings;
    expect(posted).toEqual({ ...ON_DISK, validators_graffiti: "My node" });
    expect(posted.unknown_future_field).toEqual({ keep: ["me"] });
    expect(posted.legacy_flag).toBe(false);
    // Fields missing from the old file are not invented.
    expect("mev_boost" in posted).toBe(false);
    expect("initial_state" in posted).toBe(false);
    expect(saved).toEqual(posted);
  });

  it("works through the monitor's double-encoded settings too", async () => {
    const m = createFetchMock()
      .on("GET", `${API}/settings`, { json: JSON.stringify(ON_DISK) })
      .on("POST", `${API}/settings`, { json: "Saved settings and restarted" });
    const backend = createPackageBackend({ apiUrl: API, backend: "monitor" }, { fetch: m.fetch });
    await saveSettingsMerged(backend, { mev_boost: true });
    expect(m.calls[1].body).toEqual({ ...ON_DISK, mev_boost: true });
  });

  it("uses what is on disk now, not what the page loaded earlier", async () => {
    let onDisk: Settings = { ...ON_DISK };
    const backend: PackageBackend = {
      getSettings: async () => ({ ...onDisk }),
      saveSettings: async (s) => {
        onDisk = { ...s };
      },
      getDefaultSettings: async () => ({}),
      service: async () => {},
      serviceStatus: async () => [],
    };
    // Someone else changed the graffiti after this page loaded.
    onDisk.validators_graffiti = "changed elsewhere";
    await saveSettingsMerged(backend, { mev_boost: true });
    expect(onDisk.validators_graffiti).toBe("changed elsewhere");
    expect(onDisk.mev_boost).toBe(true);
  });

  it("ignores undefined in the patch instead of deleting the field", async () => {
    const m = createFetchMock()
      .on("GET", `${API}/settings`, { json: ON_DISK })
      .on("POST", `${API}/settings`, { text: "ok" });
    const backend = createPackageBackend({ apiUrl: API, backend: "deno" }, { fetch: m.fetch });
    await saveSettingsMerged(backend, { validators_graffiti: undefined, mev_boost: false });
    expect(m.calls[1].body).toEqual({ ...ON_DISK, mev_boost: false });
  });

  it("never POSTs when the GET fails", async () => {
    const m = createFetchMock().on("GET", `${API}/settings`, networkDown());
    const backend = createPackageBackend({ apiUrl: API, backend: "deno" }, { fetch: m.fetch });
    await expect(saveSettingsMerged(backend, { mev_boost: true })).rejects.toMatchObject({ kind: "unreachable" });
    expect(m.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

describe("changedFields", () => {
  it("returns only the fields whose value differs", () => {
    const before: Settings = { a: 1, b: "x", c: { d: [1] }, mev_boost: false };
    const after: Settings = { a: 1, b: "y", c: { d: [1] }, mev_boost: true, e: "" };
    expect(changedFields(before, after)).toEqual({ b: "y", mev_boost: true, e: "" });
  });

  it("does not report a default shown for a field the file lacks until it is edited", () => {
    const before: Settings = { network: "mainnet" };
    const shown: Settings = { network: "mainnet", p2p_peer_upper_bound: 100 };
    // The page shows p2p_peer_upper_bound=100 as a default; untouched, it must not be written.
    expect(changedFields({ ...before, p2p_peer_upper_bound: 100 }, shown)).toEqual({});
  });
});
