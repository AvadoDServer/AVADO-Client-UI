import { MOCK_LIDO_CREDENTIALS, MOCK_LIDO_PUBKEYS, mockLidoDepositData } from "../../api/mockLido";
import { MOCK_MEVBOOST_RELAYS, fakeHex } from "../../api/mock";
import { checksumState } from "../checksum";
import { LIDO_NETWORKS, checkRelays, isLidoCredentials, isLidoFeeRecipient, lidoNetwork, parseRelays, readDepositData } from "../lido";

const mainnet = LIDO_NETWORKS.mainnet!;
const hoodi = LIDO_NETWORKS.hoodi!;
const vault = mainnet.withdrawalVault.slice(2).toLowerCase();

describe("Lido addresses", () => {
  it("are well-formed, checksummed addresses (a typo would break the checksum)", () => {
    for (const n of [mainnet, hoodi]) {
      for (const a of [n.withdrawalVault, n.elRewardsVault, n.relayListContract]) expect(checksumState(a)).toBe("valid");
    }
  });

  it("are the ones Lido publishes (docs.lido.fi deployed contracts, checked on-chain 2026-11-04)", () => {
    expect(mainnet.elRewardsVault).toBe("0x388C818CA8B9251b393131C08a736A67ccB19297");
    expect(mainnet.withdrawalVault).toBe("0xB9D7934878B5FB9610B3fE8A5e441e8fad7E293f");
    expect(hoodi.elRewardsVault).toBe("0x9b108015fe433F173696Af3Aa0CF7CDb3E104258");
    expect(hoodi.withdrawalVault).toBe("0x4473dCDDbf77679A643BdB654dbd86D67F8d32f2");
  });

  it("exist only for mainnet and Hoodi", () => {
    expect(lidoNetwork("mainnet")).not.toBeNull();
    expect(lidoNetwork("hoodi")).not.toBeNull();
    for (const n of ["gnosis", "holesky", "prater"] as const) expect(lidoNetwork(n)).toBeNull();
  });
});

describe("isLidoCredentials", () => {
  it("accepts 0x01 and 0x02 credentials to Lido's withdrawal vault, in any case", () => {
    expect(isLidoCredentials(`0x01${"00".repeat(11)}${vault}`, "mainnet")).toBe(true);
    expect(isLidoCredentials(`0x02${"00".repeat(11)}${vault}`, "mainnet")).toBe(true);
    expect(isLidoCredentials(`0x01${"00".repeat(11)}${vault.toUpperCase()}`, "mainnet")).toBe(true);
  });

  it("rejects another address, 0x00 credentials, another network and junk", () => {
    expect(isLidoCredentials(`0x01${"00".repeat(11)}${"ab".repeat(20)}`, "mainnet")).toBe(false);
    expect(isLidoCredentials(`0x00${vault.padStart(62, "0")}`, "mainnet")).toBe(false);
    expect(isLidoCredentials(`0x01${"00".repeat(11)}${vault}`, "hoodi")).toBe(false);
    expect(isLidoCredentials(`0x01${"00".repeat(11)}${vault}`, "gnosis")).toBe(false);
    expect(isLidoCredentials("", "mainnet")).toBe(false);
    expect(isLidoCredentials(null, "mainnet")).toBe(false);
  });

  it("isLidoFeeRecipient compares addresses without caring about case", () => {
    expect(isLidoFeeRecipient(mainnet.elRewardsVault.toLowerCase(), "mainnet")).toBe(true);
    expect(isLidoFeeRecipient(mainnet.withdrawalVault, "mainnet")).toBe(false);
    expect(isLidoFeeRecipient(undefined, "mainnet")).toBe(false);
  });
});

describe("readDepositData", () => {
  const keys = [MOCK_LIDO_PUBKEYS.lidoActive, MOCK_LIDO_PUBKEYS.lidoQueued];

  it("finds the keys that pay out to Lido", () => {
    expect(readDepositData(mockLidoDepositData(keys), "mainnet")).toEqual({ kind: "lido", lido: keys, other: [] });
  });

  it("keeps the keys of a mixed file apart", () => {
    const own = `0x01${"00".repeat(11)}${"cd".repeat(20)}`;
    const mixed = [...JSON.parse(mockLidoDepositData([keys[0]])), ...JSON.parse(mockLidoDepositData([keys[1]], own))];
    expect(readDepositData(JSON.stringify(mixed), "mainnet")).toEqual({ kind: "lido", lido: [keys[0]], other: [keys[1]] });
  });

  it("says when no key pays out to Lido", () => {
    const own = `0x01${"00".repeat(11)}${"cd".repeat(20)}`;
    expect(readDepositData(mockLidoDepositData(keys, own), "mainnet")).toEqual({ kind: "not-lido", count: 2 });
  });

  it("says when the file is for another network", () => {
    expect(readDepositData(mockLidoDepositData(keys), "hoodi")).toEqual({ kind: "wrong-network", fileNetwork: "mainnet" });
    const hoodiFile = JSON.parse(mockLidoDepositData(keys)).map((d: Record<string, unknown>) => ({ ...d, network_name: undefined, fork_version: "10000910" }));
    expect(readDepositData(JSON.stringify(hoodiFile), "mainnet")).toEqual({ kind: "wrong-network", fileNetwork: "fork 10000910" });
  });

  it("rejects files that are not deposit data", () => {
    expect(readDepositData("not json", "mainnet").kind).toBe("not-deposit-data");
    expect(readDepositData("[]", "mainnet").kind).toBe("not-deposit-data");
    expect(readDepositData(JSON.stringify({ crypto: {}, pubkey: "ab" }), "mainnet").kind).toBe("not-deposit-data");
  });

  it("skips entries with a broken pubkey", () => {
    const file = JSON.parse(mockLidoDepositData(keys));
    file[1].pubkey = "1234";
    expect(readDepositData(JSON.stringify(file), "mainnet")).toEqual({ kind: "lido", lido: [keys[0]], other: [] });
  });

  it("uses the same credentials as the mock Lido box", () => {
    expect(isLidoCredentials(MOCK_LIDO_CREDENTIALS, "mainnet")).toBe(true);
  });
});

describe("checkRelays", () => {
  const list = mainnet.relays!;
  const relayUrl = (host: string) => {
    const r = list.find((l) => l.host === host)!;
    return `https://${r.pubkey}@${r.host}`;
  };

  it("passes AVADO MEV-Boost's default relays", () => {
    const check = checkRelays(MOCK_MEVBOOST_RELAYS, list);
    expect(check.kind).toBe("ok");
    if (check.kind === "ok") expect(check.relays).toHaveLength(7);
  });

  it("names relays that are not on Lido's list", () => {
    const other = `https://${fakeHex(77, 48)}@relay.example.org`;
    const check = checkRelays(`${relayUrl("boost-relay.flashbots.net")},${other}`, list);
    expect(check.kind).toBe("not-allowed");
    if (check.kind === "not-allowed") expect(check.notAllowed.map((r) => r.host)).toEqual(["relay.example.org"]);
  });

  it("treats a known host with another relay key as not allowed", () => {
    const check = checkRelays(`https://${fakeHex(78, 48)}@boost-relay.flashbots.net`, list);
    expect(check.kind).toBe("not-allowed");
  });

  it("asks for one of Lido's main relays when only optional ones are used", () => {
    expect(checkRelays(`${relayUrl("global.titanrelay.xyz")},${relayUrl("regional.titanrelay.xyz")}`, list).kind).toBe("no-must-use");
  });

  it("reports no relays at all", () => {
    expect(checkRelays("", list).kind).toBe("none");
    expect(checkRelays(" , ", list).kind).toBe("none");
  });

  it("reads relays like the Admin does: scheme optional, spaces and trailing slashes ignored", () => {
    const r = list[0];
    const parsed = parseRelays(` ${r.pubkey.toUpperCase().replace("0X", "0x")}@${r.host.toUpperCase()}/ ,http://${r.pubkey}@${r.host}`);
    expect(parsed.map((p) => [p.host, p.pubkey])).toEqual([
      [r.host, r.pubkey],
      [r.host, r.pubkey],
    ]);
    expect(checkRelays(parsed.map((p) => p.url).join(","), list).kind).toBe("ok");
  });
});
