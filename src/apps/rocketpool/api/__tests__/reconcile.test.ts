import { createFetchMock } from "../../../../api/__tests__/fetchMock";
import { RpApiError, plainError } from "../errors";
import { DEMO, SCENARIOS } from "../fixtures";
import { createMockRocketpoolApi } from "../mock";
import { APPROVE_CONFIRMATION } from "../models";
import { createRealRocketpoolApi } from "../real";
import { normalizePubkey, parseReconcileStatus, reconcileStatusOf } from "../reconcile";

const PK = "ab".repeat(48);

/** A status as the backend loop writes it (reconcile/run.ts, version 1). */
const LOOP_STATUS = {
  version: 1,
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
  otherClients: [{ id: "prysm", name: "Prysm", package: "eth2validator.avado.dnp.dappnode.eth", checked: false, error: "not reachable" }],
  unknownValidatorPackages: [],
  keys: { total: 3, inSync: 1, imported: 0, summary: "1/3" },
  feeRecipients: { total: 1, ok: 1, fixed: 0, failed: 0 },
  fee: null,
  validators: [
    {
      pubkey: "ef".repeat(48),
      kind: "minipool",
      ref: "0x1234567890abcdef1234567890abcdef12345678",
      state: "loaded",
      feeRecipient: { rule: "fee-distributor", expected: "0x1234567890abcdef1234567890abcdef12345678", found: null, state: "fixed" },
    },
    { pubkey: PK, kind: "megapool", ref: 3, state: "awaiting-approval", feeRecipient: { rule: "megapool", expected: null, state: "not-loaded" } },
    { pubkey: "zz", kind: "megapool", ref: 4, state: "loaded", feeRecipient: {} },
  ],
  errors: [],
};

describe("key check status", () => {
  it("reads the loop's status, normalising pubkeys and dropping entries it can't trust", () => {
    const s = parseReconcileStatus(LOOP_STATUS)!;
    expect(s.state).toBe("attention");
    expect(s.message).toMatch(/wait for your approval/);
    expect(s.finishedAt).toBe("2026-09-23T10:00:02.140Z");
    expect(s.trigger).toBe("request");
    expect(s.client).toEqual({ id: "teku", name: "Teku", package: "teku.avado.dnp.dappnode.eth" });
    expect(s.clientChoice).toEqual({ source: "setting", why: 'The Rocket Pool package setting CONSENSUSCLIENT is "teku".' });
    expect(s.awaitingApproval).toEqual([PK, "cd".repeat(48)]);
    expect(s.otherClients).toEqual([{ id: "prysm", name: "Prysm", package: "eth2validator.avado.dnp.dappnode.eth", checked: false, error: "not reachable" }]);
    expect(s.keys).toEqual({ total: 3, inSync: 1, imported: 0, summary: "1/3" });
    expect(s.validators.map((v) => [v.state, v.ref, v.feeRecipient.state])).toEqual([
      ["loaded", "0x1234567890abcdef1234567890abcdef12345678", "fixed"],
      ["awaiting-approval", "3", "not-loaded"],
    ]); // the invalid pubkey "zz" is dropped
  });

  it("gives safe defaults for a partial file, and nothing for something that isn't a status", () => {
    const s = parseReconcileStatus({ state: "waiting", keys: { total: -1, inSync: 5 }, awaitingApproval: ["nope", 7], client: {} })!;
    expect(s).toMatchObject({ state: "waiting", message: "", client: null, clientChoice: null, awaitingApproval: [], errors: [], validators: [] });
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
    expect(reconcileStatusOf(SCENARIOS.mixed.reconcile)!.awaitingApproval).toEqual([DEMO.megaPubkey2]);
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
