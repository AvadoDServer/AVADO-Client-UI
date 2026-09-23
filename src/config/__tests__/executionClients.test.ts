import { EXECUTION_CLIENTS, executionClientsForNetwork, findExecutionClient } from "../executionClients";

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
});
