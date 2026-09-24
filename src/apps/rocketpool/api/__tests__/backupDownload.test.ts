import { RpApiError, errorDetails, plainError } from "../errors";
import { DEMO_BACKUP_ZIP, DEMO_MANUAL_BACKUP, NO_BACKUP, NO_WALLET_TO_BACK_UP, createMockRocketpoolApi } from "../mock";
import { DEMO } from "../fixtures";
import { CURRENT_BACKUP } from "../models";
import { AVADO_BACKUP_DOWNLOAD_PATH, backupFileName, createRealRocketpoolApi, isBackupName } from "../real";

interface Seen {
  url: string;
  init: RequestInit;
}

/** A fetch that answers every call with `make()` and records what was asked. */
function fetchWith(make: () => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    seen.push({ url: String(input), init });
    return make();
  }) as unknown as typeof fetch;
  return { impl, seen };
}

const zip = (headers: Record<string, string> = {}) =>
  new Response(DEMO_BACKUP_ZIP, { status: 200, headers: { "Content-Type": "application/zip", ...headers } });

describe("backup download: real adapter", () => {
  it("POSTs {name} as JSON with the CSRF header and returns the file with the backend's name", async () => {
    const { impl, seen } = fetchWith(() => zip({ "Content-Disposition": 'attachment; filename="rocketpool-backup-1.0.0-20260921T090000Z.zip"' }));
    const file = await createRealRocketpoolApi(impl).downloadBackup("1.0.0-20260921T090000Z");
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(AVADO_BACKUP_DOWNLOAD_PATH);
    expect(seen[0].init.method).toBe("POST");
    const headers = new Headers(seen[0].init.headers);
    expect(headers.get("x-avado-request")).toBe("1");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ name: "1.0.0-20260921T090000Z" });
    expect(seen[0].init.redirect).toBe("error");
    expect(file.fileName).toBe("rocketpool-backup-1.0.0-20260921T090000Z.zip");
    expect(file.blob.size).toBe(DEMO_BACKUP_ZIP.length);
  });

  it("asks for a fresh backup with name \"current\"", async () => {
    const { impl, seen } = fetchWith(() => zip());
    const file = await createRealRocketpoolApi(impl).downloadBackup(CURRENT_BACKUP);
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ name: "current" });
    expect(file.fileName).toBe("rocketpool-wallet-backup.zip");
  });

  it("never sends a path: anything that isn't a backup name is refused before any request", async () => {
    const { impl, seen } = fetchWith(() => zip());
    const api = createRealRocketpoolApi(impl);
    for (const bad of ["../wallet", "a/b", "", "..", "/rocketpool/data", "x".repeat(201)]) {
      await expect(api.downloadBackup(bad)).rejects.toBeInstanceOf(TypeError);
    }
    expect(seen).toHaveLength(0);
    expect(isBackupName("mnemonic-archive-20260923T101500Z-2")).toBe(true);
    expect(isBackupName("0.0.111+b-20260921T090000Z")).toBe(true);
    expect(isBackupName("a..b")).toBe(false);
    expect(isBackupName("x".repeat(200))).toBe(true); // the backend's limit
  });

  it("keeps only plain .zip file names from the backend", () => {
    expect(backupFileName("current", 'attachment; filename="avado-rocketpool-backup-1a2b3c4d-20260923.zip"')).toBe("avado-rocketpool-backup-1a2b3c4d-20260923.zip");
    expect(backupFileName("x", 'attachment; filename="../../evil.zip"')).toBe("rocketpool-backup-x.zip");
    expect(backupFileName("x", 'attachment; filename="notes.txt"')).toBe("rocketpool-backup-x.zip");
    expect(backupFileName("x", "attachment; filename*=UTF-8''good-1.zip")).toBe("good-1.zip");
    expect(backupFileName("x", null)).toBe("rocketpool-backup-x.zip");
  });

  it("passes the backend's refusal on in its own words, with the technical side kept for Details", async () => {
    const { impl } = fetchWith(() => new Response(JSON.stringify({ status: "error", error: NO_BACKUP }), { status: 404, headers: { "Content-Type": "application/json" } }));
    const e = await createRealRocketpoolApi(impl).downloadBackup("gone-20260921T090000Z").catch((x: RpApiError) => x);
    expect(e).toMatchObject({ kind: "http", status: 404, detail: NO_BACKUP });
    expect(plainError(e)).toBe(NO_BACKUP);
    expect(errorDetails(e)).toBe(`${AVADO_BACKUP_DOWNLOAD_PATH} · http · HTTP 404 · ${NO_BACKUP}`);
  });

  it("an older package without the endpoint: a plain 'update the package', never 'HTTP 404'", async () => {
    const { impl } = fetchWith(() => new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } }));
    const e = await createRealRocketpoolApi(impl).downloadBackup(CURRENT_BACKUP).catch((x: RpApiError) => x);
    expect(plainError(e)).toMatch(/^This version of the Rocket Pool package can't do this yet\. Update the package/);
    expect(plainError(e)).not.toMatch(/404|HTTP/);
  });

  it("a 200 that isn't a file (a web page, JSON, or empty) is not a backup", async () => {
    for (const res of [
      () => new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } }),
      () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
      () => new Response(new Uint8Array(0), { status: 200, headers: { "Content-Type": "application/zip" } }),
    ]) {
      const { impl } = fetchWith(res);
      await expect(createRealRocketpoolApi(impl).downloadBackup(CURRENT_BACKUP)).rejects.toMatchObject({ kind: "invalid" });
    }
  });

  it("no answer: unreachable, in plain words", async () => {
    const e = await createRealRocketpoolApi((async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch)
      .downloadBackup(CURRENT_BACKUP)
      .catch((x: RpApiError) => x);
    expect(e).toMatchObject({ kind: "unreachable" });
    expect(plainError(e)).toMatch(/not answering/);
  });
});

describe("backup download: mock adapter", () => {
  it("answers a small zip for \"current\" and for every listed backup, and 404 otherwise", async () => {
    const api = createMockRocketpoolApi({ scenario: "exits" });
    const fileName = `avado-rocketpool-backup-${DEMO.nodeAddress.slice(2, 10).toLowerCase()}-20260923.zip`;
    expect((await api.avadoStatus()).backups.map((b) => b.name)).not.toContain(DEMO_MANUAL_BACKUP);
    const current = await api.downloadBackup(CURRENT_BACKUP);
    expect(current.fileName).toBe(fileName);
    expect(current.blob.size).toBe(22);
    // As the backend: the fresh backup stays on the box, listed as kind "manual".
    expect((await api.avadoStatus()).backups[0]).toMatchObject({ name: DEMO_MANUAL_BACKUP, kind: "manual" });
    const listed = await api.downloadBackup("legacy-20260919T081100Z");
    expect(listed.fileName).toBe(fileName);
    await expect(api.downloadBackup("not-there")).rejects.toMatchObject({ status: 404, detail: NO_BACKUP });
    await expect(api.downloadBackup("../x")).rejects.toMatchObject({ status: 400 });
    expect(api.calls.filter((c) => c.path === AVADO_BACKUP_DOWNLOAD_PATH).map((c) => c.params)).toEqual([
      { name: "current" },
      { name: "legacy-20260919T081100Z" },
      { name: "not-there" },
      { name: "../x" },
    ]);
  });

  it("no wallet: nothing to back up", async () => {
    await expect(createMockRocketpoolApi({ scenario: "fresh" }).downloadBackup(CURRENT_BACKUP)).rejects.toMatchObject({
      status: 404,
      detail: NO_WALLET_TO_BACK_UP,
    });
  });

  it("the archived recovery-phrase file can be downloaded once it was moved", async () => {
    const api = createMockRocketpoolApi({ scenario: "mixed" });
    const { name } = await api.archiveLegacyMnemonic("ARCHIVE");
    await expect(api.downloadBackup(name)).resolves.toMatchObject({ blob: expect.any(Blob) });
  });
});

describe("plain error words", () => {
  const sn = (detail: string) => new RpApiError({ kind: "smartnode", path: "/api/sn/node/deposit", status: 200, detail });

  it("puts known Smartnode messages in plain words with the next step", () => {
    expect(plainError(sn("insufficient funds for gas * price + value"))).toMatch(/^The node wallet doesn't have enough ETH/);
    expect(plainError(sn("nonce too low"))).toMatch(/still waiting to go through/);
    expect(plainError(sn("execution reverted: Invalid amount"))).toMatch(/^Ethereum would reject this transaction, so it was not sent/);
    expect(plainError(sn("Post \"http://teku:5052\": dial tcp 172.18.0.5:5052: connect: connection refused"))).toMatch(
      /^Rocket Pool couldn't reach one of your Ethereum clients/,
    );
  });

  it("never shows codes, hashes or internal paths; keeps plain sentences as they are", () => {
    const hashy = plainError(sn("rpc error: code = Unknown desc = 0xdeadbeefdeadbeefdeadbeef"));
    expect(hashy).toBe("Rocket Pool couldn't do this right now. Try again in a minute; if it keeps happening, contact AVADO support.");
    expect(plainError(sn("could not open /rocketpool/data/wallet"))).not.toContain("/rocketpool/");
    expect(plainError(sn("The node's withdrawal address has already been set"))).toBe("The node's withdrawal address has already been set.");
    expect(plainError(new RpApiError({ kind: "http", path: "/x", status: 500 }))).not.toMatch(/HTTP|500/);
  });
});
