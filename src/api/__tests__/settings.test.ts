import { createPackageBackend } from "../backend";
import { changedFields, deepEqual, saveSettingsMerged, SETTINGS_CHANGED_MESSAGE, SettingsChangedError } from "../settings";
import type { PackageBackend, Settings } from "../types";
import { createFetchMock, networkDown } from "./fetchMock";

const API = "http://nimbus.my.ava.do:9999";

const DEFAULTS: Settings = {
  network: "mainnet",
  ee_endpoint: "http://ethchain-geth.my.ava.do:8551",
  execution_engine: "ethchain-geth.public.dappnode.eth",
  validators_graffiti: "Avado Nimbus",
  p2p_peer_lower_bound: 64,
  p2p_peer_upper_bound: 100,
  validators_proposer_default_fee_recipient: "",
  mev_boost: false,
};

/** A PackageBackend around one settings object, like the box. */
function box(onDisk: Settings, defaults: Settings = DEFAULTS) {
  const state = { onDisk: { ...onDisk }, posts: [] as Settings[] };
  const backend: PackageBackend = {
    getSettings: async () => ({ ...state.onDisk }),
    saveSettings: async (s) => {
      state.posts.push(s);
      state.onDisk = { ...s };
    },
    getDefaultSettings: async () => ({ ...defaults }),
    service: async () => {},
    serviceStatus: async () => [],
  };
  return { backend, state };
}

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
      .on("GET", `${API}/defaultsettings`, { json: DEFAULTS })
      .on("POST", `${API}/settings`, { text: "Saved settings and restarted" });
    const backend = createPackageBackend({ apiUrl: API, backend: "deno" }, { fetch: m.fetch });

    const saved = await saveSettingsMerged(backend, { validators_graffiti: "My node" }, ON_DISK);

    expect(m.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${API}/settings`,
      `GET ${API}/defaultsettings`,
      `POST ${API}/settings`,
    ]);
    const posted = m.calls[2].body as Settings;
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
      .on("GET", `${API}/defaultsettings`, { json: JSON.stringify(DEFAULTS) })
      .on("POST", `${API}/settings`, { json: "Saved settings and restarted" });
    const backend = createPackageBackend({ apiUrl: API, backend: "monitor" }, { fetch: m.fetch });
    await saveSettingsMerged(backend, { mev_boost: true }, ON_DISK);
    expect(m.calls.find((c) => c.method === "POST")?.body).toEqual({ ...ON_DISK, mev_boost: true });
  });

  it("refuses to save when a field the owner didn't edit changed on the box since the page loaded", async () => {
    const { backend, state } = box(ON_DISK);
    // Someone else changed the graffiti after this page loaded.
    state.onDisk.validators_graffiti = "changed elsewhere";
    const err = await saveSettingsMerged(backend, { mev_boost: true }, ON_DISK).catch((e) => e);
    expect(err).toBeInstanceOf(SettingsChangedError);
    expect(err).toMatchObject({ reason: "changed", fields: ["validators_graffiti"], message: SETTINGS_CHANGED_MESSAGE });
    expect(state.posts).toHaveLength(0);
    expect(state.onDisk.validators_graffiti).toBe("changed elsewhere");
  });

  it("refuses when a field was added or removed on the box, not only changed", async () => {
    const added = box(ON_DISK);
    added.state.onDisk.new_field = 1;
    await expect(saveSettingsMerged(added.backend, { mev_boost: true }, ON_DISK)).rejects.toMatchObject({ fields: ["new_field"] });
    const removed = box(ON_DISK);
    delete removed.state.onDisk.legacy_flag;
    await expect(saveSettingsMerged(removed.backend, { mev_boost: true }, ON_DISK)).rejects.toMatchObject({ fields: ["legacy_flag"] });
    expect(added.state.posts.length + removed.state.posts.length).toBe(0);
  });

  it("a change on the box to the same field the owner edited doesn't block: the owner's value wins", async () => {
    const { backend, state } = box(ON_DISK);
    state.onDisk.validators_graffiti = "changed elsewhere";
    await saveSettingsMerged(backend, { validators_graffiti: "Mine" }, ON_DISK);
    expect(state.posts[0]).toEqual({ ...ON_DISK, validators_graffiti: "Mine" });
  });

  it("refuses to save when the re-read is the backend's defaults (settings.json unreadable) and the page loaded real settings", async () => {
    // deno answers GET /settings with defaultsettings() when the file can't be read or parsed.
    const { backend, state } = box(DEFAULTS);
    const err = await saveSettingsMerged(backend, { validators_graffiti: "My node" }, ON_DISK).catch((e) => e);
    expect(err).toBeInstanceOf(SettingsChangedError);
    expect(err.message).toBe(SETTINGS_CHANGED_MESSAGE);
    // Would otherwise have written an empty fee recipient and MEV-Boost off.
    expect(state.posts).toHaveLength(0);
  });

  it("refuses on a defaults re-read even when the owner edited every field that differs", async () => {
    // The page loaded defaults + a fee recipient; the owner edits only the
    // fee recipient; the re-read is pure defaults. The per-field check alone
    // would pass, the defaults check stops it.
    const loaded = { ...DEFAULTS, validators_proposer_default_fee_recipient: "0x1111111111111111111111111111111111111111" };
    const { backend, state } = box(DEFAULTS);
    const err = await saveSettingsMerged(
      backend,
      { validators_proposer_default_fee_recipient: "0x2222222222222222222222222222222222222222" },
      loaded,
    ).catch((e) => e);
    expect(err).toMatchObject({ name: "SettingsChangedError", reason: "defaults" });
    expect(state.posts).toHaveLength(0);
  });

  it("saves normally when the page itself loaded the defaults (a fresh install)", async () => {
    const { backend, state } = box(DEFAULTS);
    await saveSettingsMerged(backend, { validators_graffiti: "Mine" }, DEFAULTS);
    expect(state.posts[0]).toEqual({ ...DEFAULTS, validators_graffiti: "Mine" });
  });

  it("key order on the box doesn't count as a change", async () => {
    const reordered = Object.fromEntries(Object.entries(ON_DISK).reverse());
    const { backend, state } = box(reordered);
    await saveSettingsMerged(backend, { mev_boost: true }, ON_DISK);
    expect(state.posts).toHaveLength(1);
  });

  it("still saves when /defaultsettings can't be read (the per-field check stands on its own)", async () => {
    const { backend, state } = box(ON_DISK);
    backend.getDefaultSettings = async () => {
      throw new Error("down");
    };
    await saveSettingsMerged(backend, { mev_boost: true }, ON_DISK);
    expect(state.posts[0]).toEqual({ ...ON_DISK, mev_boost: true });
  });

  it("ignores undefined in the patch instead of deleting the field", async () => {
    const m = createFetchMock()
      .on("GET", `${API}/settings`, { json: ON_DISK })
      .on("GET", `${API}/defaultsettings`, { json: DEFAULTS })
      .on("POST", `${API}/settings`, { text: "ok" });
    const backend = createPackageBackend({ apiUrl: API, backend: "deno" }, { fetch: m.fetch });
    await saveSettingsMerged(backend, { validators_graffiti: undefined, mev_boost: false }, ON_DISK);
    expect(m.calls.find((c) => c.method === "POST")?.body).toEqual({ ...ON_DISK, mev_boost: false });
  });

  it("never POSTs when the GET fails", async () => {
    const m = createFetchMock().on("GET", `${API}/settings`, networkDown());
    const backend = createPackageBackend({ apiUrl: API, backend: "deno" }, { fetch: m.fetch });
    await expect(saveSettingsMerged(backend, { mev_boost: true }, ON_DISK)).rejects.toMatchObject({ kind: "unreachable" });
    expect(m.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

describe("deepEqual", () => {
  it("compares JSON values structurally, ignoring key order and undefined members", () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, x: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: "1" })).toBe(false);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
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
