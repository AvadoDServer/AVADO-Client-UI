import { EXECUTION_CLIENTS, executionClientsForNetwork, executionClientTitle, findExecutionClient } from "../executionClients";

// This list must mirror AVADO-DNP-Nimbus/build/startNimbus.sh:19-35 (EE_CANDIDATES) exactly.
describe("executionClients", () => {
  it("matches startNimbus.sh's EE_CANDIDATES for mainnet", () => {
    expect(executionClientsForNetwork("mainnet").map((c) => [c.packageName, c.eeEndpoint])).toEqual([
      ["ethchain-geth.public.dappnode.eth", "http://ethchain-geth.my.ava.do:8551"],
      ["avado-dnp-nethermind.public.dappnode.eth", "http://avado-dnp-nethermind.my.ava.do:8551"],
    ]);
  });

  it("matches startNimbus.sh's EE_CANDIDATES for prater (Goerli)", () => {
    expect(executionClientsForNetwork("prater").map((c) => c.packageName)).toEqual([
      "goerli-geth.avado.dnp.dappnode.eth",
      "nethermind-goerli.avado.dnp.dappnode.eth",
    ]);
  });

  it("matches startNimbus.sh's EE_CANDIDATES for holesky (one candidate only)", () => {
    expect(executionClientsForNetwork("holesky").map((c) => c.packageName)).toEqual(["holesky-geth.avado.dnp.dappnode.eth"]);
  });

  it("matches startNimbus.sh's EE_CANDIDATES for gnosis (one candidate only)", () => {
    expect(executionClientsForNetwork("gnosis").map((c) => c.packageName)).toEqual(["nethermind-gnosis.avado.dnp.dappnode.eth"]);
  });

  it("a network with no case in the script (e.g. hoodi) has no candidates, matching EE_CANDIDATES=\"\"", () => {
    expect(executionClientsForNetwork("hoodi")).toEqual([]);
  });

  describe("Lighthouse (its previous wizard's list, no start-script auto-detection)", () => {
    it("offers Geth, Nethermind and Reth on mainnet", () => {
      expect(executionClientsForNetwork("mainnet", "lighthouse").map((c) => [c.packageName, c.eeEndpoint])).toEqual([
        ["ethchain-geth.public.dappnode.eth", "http://ethchain-geth.my.ava.do:8551"],
        ["avado-dnp-nethermind.public.dappnode.eth", "http://avado-dnp-nethermind.my.ava.do:8551"],
        ["reth-mainnet.avado.dnp.dappnode.eth", "http://reth-mainnet.my.ava.do:8551"],
      ]);
    });

    it("offers Geth, Nethermind and Reth on Holesky", () => {
      expect(executionClientsForNetwork("holesky", "lighthouse").map((c) => c.packageName)).toEqual([
        "holesky-geth.avado.dnp.dappnode.eth",
        "nethermind-holesky.avado.dnp.dappnode.eth",
        "reth-holesky.avado.dnp.dappnode.eth",
      ]);
    });

    it("offers Nethermind on Gnosis", () => {
      expect(executionClientsForNetwork("gnosis", "lighthouse").map((c) => c.packageName)).toEqual([
        "nethermind-gnosis.avado.dnp.dappnode.eth",
      ]);
    });

    it("does not change what Nimbus offers", () => {
      expect(executionClientsForNetwork("mainnet", "nimbus")).toEqual(executionClientsForNetwork("mainnet"));
      expect(executionClientsForNetwork("holesky", "nimbus")).toEqual(executionClientsForNetwork("holesky"));
      expect(executionClientsForNetwork("mainnet", "nimbus").map((c) => c.packageName)).not.toContain(
        "reth-mainnet.avado.dnp.dappnode.eth",
      );
    });

    it("findExecutionClient finds the Lighthouse-only candidates, so a save writes their endpoint", () => {
      expect(findExecutionClient("reth-mainnet.avado.dnp.dappnode.eth")?.eeEndpoint).toBe("http://reth-mainnet.my.ava.do:8551");
      expect(findExecutionClient("reth-holesky.avado.dnp.dappnode.eth")?.eeEndpoint).toBe("http://reth-holesky.my.ava.do:8551");
    });
  });

  it("every candidate has a unique package name", () => {
    const names = EXECUTION_CLIENTS.map((c) => c.packageName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("findExecutionClient looks up by package name across networks", () => {
    expect(findExecutionClient("avado-dnp-nethermind.public.dappnode.eth")?.eeEndpoint).toBe(
      "http://avado-dnp-nethermind.my.ava.do:8551",
    );
    expect(findExecutionClient("unknown.package.eth")).toBeUndefined();
    expect(findExecutionClient(undefined)).toBeUndefined();
  });

  it("every candidate has a short title for banners and sentences", () => {
    expect(executionClientsForNetwork("prater").map((c) => c.title)).toEqual(["Geth", "Nethermind"]);
    for (const c of EXECUTION_CLIENTS) expect(c.name.startsWith(c.title)).toBe(true);
  });

  it("executionClientTitle: the known title, else a guess from the package name", () => {
    expect(executionClientTitle("goerli-geth.avado.dnp.dappnode.eth")).toBe("Geth");
    expect(executionClientTitle("avado-dnp-nethermind.public.dappnode.eth")).toBe("Nethermind");
    expect(executionClientTitle("besu.public.dappnode.eth")).toBe("Besu");
    expect(executionClientTitle("mystery.avado.dnp.dappnode.eth")).toBe("Mystery");
  });
});
