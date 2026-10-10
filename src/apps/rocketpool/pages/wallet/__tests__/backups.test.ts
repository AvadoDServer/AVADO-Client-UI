import { describeBackup, describeBackups, exportFileContent, stampToMs } from "../backups";

describe("backups on the box", () => {
  it("names each kind of backup in plain words, with its time; marks the ones that hold or may hold the recovery phrase", () => {
    const at = (name: string, kind: "upgrade" | "wallet-change" = "upgrade") => describeBackup({ name, createdAt: "2026-09-01T00:00:00Z", kind });
    expect(at("legacy-20260919T081100Z")).toMatchObject({
      title: "Before the upgrade from the old package",
      name: "legacy-20260919T081100Z",
      phrase: "maybe", // the first upgrade from the old package copied its plain-text phrase file too
      time: Date.UTC(2026, 8, 19, 8, 11, 0),
    });
    expect(at("1.0.0-20260921T090000Z").title).toBe("Automatic backup (from version 1.0.0)");
    expect(at("0.0.111+b-20260921T090000Z").title).toBe("Automatic backup (from version 0.0.111+b)");
    expect(at("20260920T120000Z-before-wallet-change-2", "wallet-change").title).toBe("Before a wallet change");
    expect(at("20260923T101500Z-after-wallet-create")).toMatchObject({ title: "After creating your wallet", time: Date.UTC(2026, 8, 23, 10, 15, 0) });
    expect(at("20260923T103000Z-manual-download-2")).toMatchObject({ title: "Downloaded by you", time: Date.UTC(2026, 8, 23, 10, 30, 0) });
    // By kind, for a name the UI doesn't know.
    const byKind = (kind: "wallet-create" | "manual") => describeBackup({ name: "odd-name", createdAt: "2026-09-01T00:00:00Z", kind }).title;
    expect(byKind("wallet-create")).toBe("After creating your wallet");
    expect(byKind("manual")).toBe("Downloaded by you");
    expect(at("mnemonic-archive-20260923T101500Z")).toMatchObject({ title: "Old recovery phrase file", phrase: true });
    expect(at("1.0.0-20260921T090000Z").phrase).toBe(false);
    expect(at("legacy-20260919T081100Z").text).toContain("It may also contain your recovery phrase.");
    // An upgrade from a 0.0.x version may hold it too; a 1.x one doesn't.
    expect(at("0.0.107-20260921T090000Z")).toMatchObject({ phrase: "maybe", text: expect.stringContaining("may also contain your recovery phrase") });
    expect(at("1.0.0-20260921T090000Z").text).not.toContain("recovery phrase");
    // The backend's collision suffix, and its kind even for a name the UI doesn't know.
    const mn = (name: string) => describeBackup({ name, createdAt: "2026-09-01T00:00:00Z", kind: "mnemonic-archive" });
    expect(mn("mnemonic-archive-20260923T101500Z-2")).toMatchObject({ title: "Old recovery phrase file", time: Date.UTC(2026, 8, 23, 10, 15, 0) });
    expect(mn("renamed")).toMatchObject({ title: "Old recovery phrase file", phrase: true, time: Date.parse("2026-09-01T00:00:00Z") });
    expect(at("something-else")).toMatchObject({ title: "Backup", time: Date.parse("2026-09-01T00:00:00Z") });
    expect(describeBackup({ name: "odd", createdAt: "", kind: "upgrade" }).time).toBeNull();
  });

  it("lists newest first", () => {
    const list = describeBackups([
      { name: "legacy-20260919T081100Z", createdAt: "", kind: "upgrade" },
      { name: "1.0.0-20260921T090000Z", createdAt: "", kind: "upgrade" },
      { name: "20260920T120000Z-before-wallet-change", createdAt: "", kind: "wallet-change" },
    ]);
    expect(list.map((b) => b.name)).toEqual(["1.0.0-20260921T090000Z", "20260920T120000Z-before-wallet-change", "legacy-20260919T081100Z"]);
  });

  it("reads time stamps strictly", () => {
    expect(stampToMs("20260923T101500Z")).toBe(Date.UTC(2026, 8, 23, 10, 15, 0));
    expect(stampToMs("2026-09-23")).toBeNull();
  });

  it("the export file holds the wallet file, password and key, and says how to keep it", () => {
    const text = exportFileContent({ wallet: '{"crypto":1}', password: "pw", accountPrivateKey: "0xkey" }, "0xabc", new Date("2026-09-23T10:00:00Z"));
    const json = JSON.parse(text);
    expect(json).toMatchObject({ nodeAddress: "0xabc", createdAt: "2026-09-23T10:00:00.000Z", walletFile: '{"crypto":1}', password: "pw", accountPrivateKey: "0xkey" });
    expect(json.about).toMatch(/keep it offline and private/);
  });
});
