import { fakeHex } from "../../../api/mock";
import { fakeKeystore } from "../../validators/__tests__/renderWithApi";
import { classifyFile, importErrorText, tally, tallyText } from "../keystoreFiles";

describe("classifyFile", () => {
  it("recognises a keystore and normalises its pubkey", () => {
    const pk = fakeHex(77, 48);
    expect(classifyFile(fakeKeystore(pk.toUpperCase().replace("0X", "")))).toEqual({ kind: "keystore", pubkey: pk });
  });
  it("recognises a slashing-protection interchange file", () => {
    const text = JSON.stringify({ metadata: { interchange_format_version: "5", genesis_validators_root: "0x00" }, data: [] });
    expect(classifyFile(text).kind).toBe("slashing");
  });
  it("explains that a deposit data file isn't needed", () => {
    const c = classifyFile(JSON.stringify([{ pubkey: "ab", deposit_data_root: "cd" }]));
    expect(c.kind).toBe("deposit");
    expect(c.reason).toMatch(/deposit data file/);
  });
  it("rejects other files", () => {
    expect(classifyFile("not json").kind).toBe("invalid");
    expect(classifyFile("{}").kind).toBe("invalid");
    expect(classifyFile(JSON.stringify({ crypto: {}, pubkey: "abc" })).kind).toBe("invalid");
  });
});

describe("tally", () => {
  it("counts imported, duplicate and error results", () => {
    const t = tally([{ status: "imported" }, { status: "error", message: "x" }, { status: "duplicate" }, { status: "imported" }, undefined]);
    expect(t).toEqual({ imported: 2, duplicate: 1, error: 1 });
    expect(tallyText(t)).toBe("2 imported, 1 already on this node, 1 failed");
    expect(tallyText({ imported: 0, duplicate: 0, error: 0 })).toBe("Nothing imported");
  });
  it("says Wrong password for password errors", () => {
    expect(importErrorText("Invalid password")).toBe("Wrong password");
    expect(importErrorText("Keystore decryption failed")).toBe("Wrong password");
    expect(importErrorText("disk full")).toBe("Not imported: disk full");
  });
});
