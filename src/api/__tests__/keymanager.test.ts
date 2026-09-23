import { createKeymanagerApi } from "../keymanager";
import { createFetchMock } from "./fetchMock";

const API = "http://nimbus.my.ava.do:9999";
const KM = `${API}/keymanager/eth/v1`;
const PK = `0x${"ab".repeat(48)}`;
const PK2 = `0x${"cd".repeat(48)}`;
const ADDR = `0x${"11".repeat(20)}`;
const INTERCHANGE = { metadata: { interchange_format_version: "5", genesis_validators_root: "0x00" }, data: [] };

const make = (m: ReturnType<typeof createFetchMock>) => createKeymanagerApi({ apiUrl: API }, { fetch: m.fetch });

describe("createKeymanagerApi", () => {
  it("listKeystores unwraps data", async () => {
    const keys = [{ validating_pubkey: PK, derivation_path: "m/12381/3600/0/0/0", readonly: false }];
    const m = createFetchMock().on("GET", `${KM}/keystores`, { json: { data: keys } });
    expect(await make(m).listKeystores()).toEqual(keys);
  });

  it("the keymanager being down behind the proxy is 'upstream' (e.g. Nimbus is starting)", async () => {
    const m = createFetchMock().on("GET", `${KM}/keystores`, { status: 500, json: { error: "Connection refused (os error 111)" } });
    await expect(make(m).listKeystores()).rejects.toMatchObject({ kind: "upstream", service: "keymanager" });
  });

  it("importKeystores POSTs keystores, passwords and the optional slashing file; one result per keystore", async () => {
    const m = createFetchMock().on("POST", `${KM}/keystores`, {
      json: { data: [{ status: "imported", message: "" }, { status: "duplicate" }, { status: "error", message: "bad password" }] },
    });
    const res = await make(m).importKeystores({ keystores: ["{}", "{}", "{}"], passwords: ["a", "b", "c"], slashing_protection: "{}" });
    expect(res).toEqual([{ status: "imported", message: "" }, { status: "duplicate" }, { status: "error", message: "bad password" }]);
    expect(m.calls[0].body).toEqual({ keystores: ["{}", "{}", "{}"], passwords: ["a", "b", "c"], slashing_protection: "{}" });
  });

  it("importKeystores leaves slashing_protection out when there is none", async () => {
    const m = createFetchMock().on("POST", `${KM}/keystores`, { json: { data: [{ status: "imported" }] } });
    await make(m).importKeystores({ keystores: ["{}"], passwords: ["a"] });
    expect(m.calls[0].body).toEqual({ keystores: ["{}"], passwords: ["a"] });
  });

  it("normalises upper-case statuses (Prysm) to the standard lower case", async () => {
    const m = createFetchMock()
      .on("POST", `${KM}/keystores`, { json: { data: [{ status: "IMPORTED" }, { status: "DUPLICATE" }] } })
      .on("DELETE", `${KM}/keystores`, { json: { data: [{ status: "NOT_ACTIVE" }], slashing_protection: JSON.stringify(INTERCHANGE) } });
    const km = make(m);
    expect((await km.importKeystores({ keystores: ["{}", "{}"], passwords: ["a", "b"] })).map((r) => r.status)).toEqual(["imported", "duplicate"]);
    expect((await km.deleteKeystores([PK])).data[0].status).toBe("not_active");
  });

  it("deleteKeystores sends the pubkeys and returns the slashing-protection export as a string", async () => {
    const m = createFetchMock().on("DELETE", `${KM}/keystores`, {
      json: { data: [{ status: "deleted", message: "" }], slashing_protection: JSON.stringify(INTERCHANGE) },
    });
    const res = await make(m).deleteKeystores([PK]);
    expect(m.calls[0].body).toEqual({ pubkeys: [PK] });
    expect(m.calls[0].headers["content-type"]).toBe("application/json");
    expect(res.data).toEqual([{ status: "deleted", message: "" }]);
    expect(typeof res.slashing_protection).toBe("string");
    expect(JSON.parse(res.slashing_protection as string)).toEqual(INTERCHANGE);
  });

  it("deleteKeystores stringifies an interchange that arrives as an object", async () => {
    const m = createFetchMock().on("DELETE", `${KM}/keystores`, { json: { data: [{ status: "deleted" }], slashing_protection: INTERCHANGE } });
    const sp = (await make(m).deleteKeystores([PK])).slashing_protection;
    expect(typeof sp).toBe("string");
    expect(JSON.parse(sp as string)).toEqual(INTERCHANGE);
  });

  it("deleteKeystores without a slashing-protection export still returns the per-key statuses (the key was removed)", async () => {
    const m = createFetchMock().on("DELETE", `${KM}/keystores`, { json: { data: [{ status: "deleted" }] } });
    const res = await make(m).deleteKeystores([PK]);
    expect(res.data).toEqual([{ status: "deleted" }]);
    expect(res.slashing_protection).toBeUndefined();
  });

  it("getFeeRecipient returns the address, and null on 404", async () => {
    const m = createFetchMock()
      .on("GET", `${KM}/validator/${PK}/feerecipient`, { json: { data: { pubkey: PK, ethaddress: ADDR } } })
      .on("GET", `${KM}/validator/${PK2}/feerecipient`, { status: 404, json: { message: "not found" } });
    const km = make(m);
    expect(await km.getFeeRecipient(PK)).toBe(ADDR);
    expect(await km.getFeeRecipient(PK2)).toBeNull();
  });

  it("setFeeRecipient POSTs {ethaddress} (202) and deleteFeeRecipient DELETEs (204)", async () => {
    const m = createFetchMock()
      .on("POST", `${KM}/validator/${PK}/feerecipient`, { status: 202, text: "" })
      .on("DELETE", `${KM}/validator/${PK}/feerecipient`, { status: 204 });
    const km = make(m);
    await km.setFeeRecipient(PK, ADDR);
    await km.deleteFeeRecipient(PK);
    expect(m.calls[0].body).toEqual({ ethaddress: ADDR });
    // The deno proxy JSON-parses every non-GET body: a bodiless DELETE fails there.
    expect(m.calls[1].method).toBe("DELETE");
    expect(m.calls[1].rawBody).toBe("{}");
    expect(m.calls[1].headers["content-type"]).toBe("application/json");
  });

  it("setFeeRecipient surfaces a refusal", async () => {
    const m = createFetchMock().on("POST", `${KM}/validator/${PK}/feerecipient`, { status: 400, json: { message: "invalid ethaddress" } });
    await expect(make(m).setFeeRecipient(PK, "0x12")).rejects.toMatchObject({ kind: "http", status: 400, detail: "invalid ethaddress" });
  });

  it("signVoluntaryExit POSTs to the keymanager and unwraps the signed exit", async () => {
    const signed = { message: { epoch: "300000", validator_index: "7" }, signature: "0xsig" };
    const m = createFetchMock().on("POST", `${KM}/validator/${PK}/voluntary_exit`, { json: { data: signed } });
    expect(await make(m).signVoluntaryExit(PK)).toEqual(signed);
    // The deno proxy JSON-parses every non-GET body: a bodiless POST fails there.
    expect(m.calls[0].rawBody).toBe("{}");
    expect(m.calls[0].headers["content-type"]).toBe("application/json");
  });

  it("signVoluntaryExit refuses an explicit epoch, which the package proxies cannot forward", async () => {
    const m = createFetchMock();
    await expect(make(m).signVoluntaryExit(PK, "123")).rejects.toThrow(/epoch/);
    expect(m.calls).toHaveLength(0);
  });

  it("encodes the pubkey into the path", async () => {
    const m = createFetchMock().on("GET", `${KM}/validator/0x%2F..%2Fkeystores/feerecipient`, { status: 404, json: { message: "no" } });
    expect(await make(m).getFeeRecipient("0x/../keystores")).toBeNull();
  });
});
