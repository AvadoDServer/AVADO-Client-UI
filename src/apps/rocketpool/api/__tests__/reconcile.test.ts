import { createFetchMock } from "../../../../api/__tests__/fetchMock";
import { RpApiError, plainError } from "../errors";
import { DEMO, SCENARIOS } from "../fixtures";
import { createMockRocketpoolApi } from "../mock";
import { APPROVE_CONFIRMATION } from "../models";
import { createRealRocketpoolApi } from "../real";
import { normalizePubkey, parseReconcileStatus, reconcileStatusOf } from "../reconcile";

const PK = "ab".repeat(48);

/** A status as the backend loop writes it (reconcile/run.ts, STATUS_VERSION 2). */
const LOOP_STATUS = {
  version: 2,
  state: "attention",
  message: "Validator keys in sync with Teku: 1/3. 2 validator keys are not loaded and wait for your approval.",
  startedAt: "2026-09-23T10:00:00.000Z",
  finishedAt: "2026-09-23T10:00:02.140Z",
  durationMs: 2140,
  trigger: "request",
  nextRunAt: "2026-09-23T10:05:02.140Z",
  client: { id: "teku", name: "Teku", package: "teku.avado.dnp.dappnode.eth" },
  configuredClient: "teku",
  clientChoice: { source: "setting", why: 'The Rocket Pool package setting CONSENSUSCLIENT is "teku".' },
  awaitingApproval: [PK, `0x${"CD".repeat(48)}`],
  importBlockedReasons: ["The keys in Prysm (eth2validator.avado.dnp.dappnode.eth) could not be checked."],
  loadedTwice: [],
  clients: [
    {
      id: "teku",
      name: "Teku",
      package: "teku.avado.dnp.dappnode.eth",
      version: "0.0.76",
      chosen: true,
      checked: true,
      rocketPoolKeys: 1,
      feeRecipients: { ok: 0, fixed: 1, failed: 0 },
    },
    { id: "prysm", name: "Prysm", package: "eth2validator.avado.dnp.dappnode.eth", version: null, chosen: false, checked: false, error: "not reachable", rocketPoolKeys: 0, feeRecipients: { ok: 0, fixed: 0, failed: 0 } },
  ],
  unknownValidatorPackages: [],
  keys: { total: 3, inSync: 1, imported: 0, summary: "1/3" },
  feeRecipients: { total: 1, ok: 0, fixed: 1, failed: 0 },
  fee: null,
  validators: [
    {
      pubkey: "ef".repeat(48),
      kind: "minipool",
      ref: "0x1234567890abcdef1234567890abcdef12345678",
      state: "loaded",
      loadedIn: ["teku.avado.dnp.dappnode.eth"],
      feeRecipient: {
        rule: "fee-distributor",
        expected: "0x1234567890abcdef1234567890abcdef12345678",
        state: "fixed",
        clients: [{ package: "teku.avado.dnp.dappnode.eth", found: null, state: "fixed" }],
      },
    },
    { pubkey: PK, kind: "megapool", ref: 3, state: "settling", loadedIn: [], settlesAt: "2026-09-23T10:20:00.000Z", feeRecipient: { rule: "megapool", expected: null, state: "not-loaded", clients: [] } },
    { pubkey: "zz", kind: "megapool", ref: 4, state: "loaded", loadedIn: [], feeRecipient: {} },
  ],
  errors: [],
};

describe("key check status", () => {
  it("reads the loop's v2 status, normalising pubkeys and dropping entries without a valid key", () => {
    const s = parseReconcileStatus(LOOP_STATUS)!;
    expect(s.version).toBe(2);
    expect(s.newerThanUi).toBe(false);
    expect(s.state).toBe("attention");
    expect(s.message).toMatch(/wait for your approval/);
    expect(s.finishedAt).toBe("2026-09-23T10:00:02.140Z");
    expect(s.trigger).toBe("request");
    expect(s.client).toEqual({ id: "teku", name: "Teku", package: "teku.avado.dnp.dappnode.eth" });
    expect(s.clientChoice).toEqual({ source: "setting", why: 'The Rocket Pool package setting CONSENSUSCLIENT is "teku".' });
    expect(s.awaitingApproval).toEqual([PK, "cd".repeat(48)]);
    expect(s.importBlockedReasons).toEqual(["The keys in Prysm (eth2validator.avado.dnp.dappnode.eth) could not be checked."]);
    expect(s.clients.map((c) => [c.name, c.chosen, c.checked, c.version, c.error])).toEqual([
      ["Teku", true, true, "0.0.76", undefined],
      ["Prysm", false, false, null, "not reachable"],
    ]);
    expect(s.keys).toEqual({ total: 3, inSync: 1, imported: 0, summary: "1/3" });
    expect(s.validators.map((v) => [v.state, v.ref, v.loadedIn, v.feeRecipient.state])).toEqual([
      ["loaded", "0x1234567890abcdef1234567890abcdef12345678", ["teku.avado.dnp.dappnode.eth"], "fixed"],
      ["settling", "3", [], "not-loaded"],
    ]); // the invalid pubkey "zz" is dropped
    expect(s.validators[1].settlesAt).toBe("2026-09-23T10:20:00.000Z");
    expect(s.validators[0].feeRecipient.clients).toEqual([{ package: "teku.avado.dnp.dappnode.eth", found: null, state: "fixed" }]);
    expect(s.loadedTwice).toEqual([]);
  });

  it("never drops danger: unknown key states are kept, a key in two clients is loaded twice", () => {
    const s = parseReconcileStatus({
      ...LOOP_STATUS,
      loadedTwice: [{ pubkey: `0x${"11".repeat(48)}`, packages: ["nimbus.avado.dnp.dappnode.eth", "teku.avado.dnp.dappnode.eth"] }],
      validators: [
        { pubkey: "22".repeat(48), state: "quarantined", loadedIn: [], feeRecipient: {} },
        { pubkey: "33".repeat(48), state: "loaded", loadedIn: ["nimbus.avado.dnp.dappnode.eth", "teku.avado.dnp.dappnode.eth"], feeRecipient: {} },
        { pubkey: "44".repeat(48), state: "elsewhere", loadedIn: "eth2validator.avado.dnp.dappnode.eth", feeRecipient: {} }, // v1: a string
      ],
    })!;
    expect(s.validators.map((v) => [v.state, v.rawState])).toEqual([
      ["unknown", "quarantined"],
      ["loaded-twice", "loaded"],
      ["elsewhere", "elsewhere"],
    ]);
    expect(s.validators[2].loadedIn).toEqual(["eth2validator.avado.dnp.dappnode.eth"]);
    expect(s.loadedTwice.map((t) => t.pubkey)).toEqual(["11".repeat(48), "33".repeat(48)]);
  });

  it("reads a newer version with an unknown overall state as needing attention; a v1 file still reads", () => {
    const newer = parseReconcileStatus({ ...LOOP_STATUS, version: 3, state: "degraded" })!;
    expect(newer).toMatchObject({ version: 3, newerThanUi: true, state: "attention" });
    expect(parseReconcileStatus({ ...LOOP_STATUS, version: 2, state: "degraded" })).toBeUndefined();
    const v1 = parseReconcileStatus({ version: 1, state: "ok", otherClients: [{ id: "prysm", name: "Prysm", package: "eth2validator.avado.dnp.dappnode.eth", checked: true }] })!;
    expect(v1.clients.map((c) => [c.name, c.chosen, c.checked])).toEqual([["Prysm", false, true]]);
  });

  it("gives safe defaults for a partial file, and nothing for something that isn't a status", () => {
    const s = parseReconcileStatus({ state: "waiting", keys: { total: -1, inSync: 5 }, awaitingApproval: ["nope", 7], client: {} })!;
    expect(s).toMatchObject({
      state: "waiting",
      message: "",
      client: null,
      clientChoice: null,
      awaitingApproval: [],
      importBlockedReasons: [],
      loadedTwice: [],
      clients: [],
      errors: [],
      validators: [],
    });
    expect(s.keys).toEqual({ total: 0, inSync: 0, imported: 0, summary: "0/0" });
    expect(parseReconcileStatus({ state: "sideways" })).toBeUndefined();
    expect(parseReconcileStatus("text")).toBeUndefined();
    expect(parseReconcileStatus(null)).toBeUndefined();
    expect(reconcileStatusOf({ available: false, runRequested: true })).toBeUndefined();
    expect(reconcileStatusOf({ available: true, runRequested: false, status: LOOP_STATUS })?.keys.total).toBe(3);
  });

  it("normalises pubkeys like the backend", () => {
    expect(normalizePubkey(`0x${"AB".repeat(48)}`)).toBe(PK);
    expect(normalizePubkey(PK.slice(2))).toBeNull();
    expect(normalizePubkey(`${PK}/../x`)).toBeNull();
    expect(normalizePubkey(42)).toBeNull();
  });

  it("every demo node's status parses", () => {
    for (const s of Object.values(SCENARIOS)) expect(reconcileStatusOf(s.reconcile)).toBeDefined();
    const mixed = reconcileStatusOf(SCENARIOS.mixed.reconcile)!;
    expect(mixed.version).toBe(2);
    expect(mixed.awaitingApproval).toEqual([DEMO.megaPubkey2]);
    expect(mixed.clients.map((c) => [c.name, c.chosen])).toEqual([["Teku", true]]);
  });
});

describe("approving keys", () => {
  it("real: POSTs {pubkeys, confirm} as JSON with X-Avado-Request: 1", async () => {
    const f = createFetchMock().on("POST", "/api/avado/reconcile/approve", {
      status: 202,
      json: { status: "success", error: "", approved: 1, added: 1, runRequested: true },
    });
    const res = await createRealRocketpoolApi(f.fetch).approveKeys([PK], APPROVE_CONFIRMATION);
    expect(res).toMatchObject({ approved: 1, added: 1, runRequested: true });
    expect(f.calls[0].headers["x-avado-request"]).toBe("1");
    expect(f.calls[0].headers["content-type"]).toBe("application/json");
    expect(f.calls[0].body).toEqual({ pubkeys: [PK], confirm: "LOAD" });
  });

  it("real: passes the backend's refusal on in its own words", async () => {
    const message = 'Type LOAD to confirm that these validators are not running anywhere else (confirm must be "LOAD").';
    const f = createFetchMock().on("POST", "/api/avado/reconcile/approve", { status: 400, json: { status: "error", error: message } });
    const e = await createRealRocketpoolApi(f.fetch).approveKeys([PK], "load").catch((x: RpApiError) => x);
    expect(e).toMatchObject({ kind: "http", status: 400 });
    expect(plainError(e)).toBe(message);
  });

  it("mock: the backend's checks, then the keys read as loaded", async () => {
    const api = createMockRocketpoolApi({ scenario: "mixed" });
    await expect(api.approveKeys([DEMO.megaPubkey2], "load")).rejects.toMatchObject({ status: 400 });
    await expect(api.approveKeys([], "LOAD")).rejects.toMatchObject({ status: 400 });
    await expect(api.approveKeys(["nope"], "LOAD")).rejects.toMatchObject({ status: 400 });
    expect(reconcileStatusOf(await api.reconcile())!.awaitingApproval).toEqual([DEMO.megaPubkey2]); // nothing written

    expect(await api.approveKeys([`0x${DEMO.megaPubkey2}`, DEMO.megaPubkey2], "LOAD")).toMatchObject({ approved: 1, added: 1 });
    expect(await api.approveKeys([DEMO.megaPubkey2], "LOAD")).toMatchObject({ approved: 1, added: 0 });
    const after = reconcileStatusOf(await api.reconcile())!;
    expect(after.awaitingApproval).toEqual([]);
    expect(after.state).toBe("ok");
    expect(after.keys.summary).toBe("3/3");
    expect(after.validators.find((v) => v.pubkey === DEMO.megaPubkey2)?.state).toBe("imported");
  });
});
