import { findProblems, type ProblemInputs } from "../problems";

const FEE = "0x" + "ab".repeat(20);
const up = (...names: string[]) => names.map((name) => ({ name, running: true }));
const down = (...names: string[]) => names.map((name) => ({ name, running: false }));
const base: ProblemInputs = {
  client: "nimbus",
  network: "mainnet",
  packageName: "nimbus.avado.dnp.dappnode.eth",
  configProblems: [],
  settings: { network: "mainnet", execution_engine: "ethchain-geth.public.dappnode.eth", validators_proposer_default_fee_recipient: FEE },
  packages: up("dappmanager.dnp.dappnode.eth", "ethchain-geth.public.dappnode.eth", "nimbus.avado.dnp.dappnode.eth"),
  elOffline: false,
};
const ids = (i: Partial<ProblemInputs>) => findProblems({ ...base, ...i }).map((p) => p.id);
const one = (i: Partial<ProblemInputs>, id: string) => findProblems({ ...base, ...i }).find((p) => p.id === id)!;

describe("findProblems", () => {
  it("finds nothing on a healthy mainnet box", () => {
    expect(findProblems(base)).toEqual([]);
  });

  it("finds nothing it can't know yet (settings and packages not loaded)", () => {
    expect(ids({ settings: undefined, packages: undefined })).toEqual([]);
    expect(ids({ settings: null, packages: null })).toEqual([]);
  });

  describe("fee recipient", () => {
    it.each([[""], ["   "], [undefined]])("flags an empty default fee recipient (%j)", (fee) => {
      const p = one({ settings: { ...base.settings, validators_proposer_default_fee_recipient: fee } }, "fee-recipient");
      expect(p.tone).toBe("warning");
      expect(p.action).toEqual({ label: "Set fee recipient", to: "/settings?focus=fee-recipient" });
    });
    it("does not flag a set fee recipient", () => {
      expect(ids({})).not.toContain("fee-recipient");
    });
  });

  describe("execution client", () => {
    it("flags a box with none of the network's candidates installed, linking to the DappStore", () => {
      const p = one({ packages: up("dappmanager.dnp.dappnode.eth") }, "no-execution-client");
      expect(p.tone).toBe("danger");
      expect(p.title).toBe("No execution client installed");
      expect(p.body).toContain("Install Geth or Nethermind from the DappStore");
      expect(p.action).toEqual({ label: "Install an execution client", href: "http://my.ava.do/#/installer" });
    });

    it("accepts any candidate for the network (Nethermind on mainnet)", () => {
      expect(
        ids({
          settings: { ...base.settings, execution_engine: "avado-dnp-nethermind.public.dappnode.eth" },
          packages: up("avado-dnp-nethermind.public.dappnode.eth"),
        }),
      ).toEqual([]);
    });

    it("matches candidates per network: mainnet Geth does not count on Holesky", () => {
      const holesky = { network: "holesky" as const, settings: { ...base.settings, network: "holesky", execution_engine: "holesky-geth.avado.dnp.dappnode.eth" } };
      expect(ids({ ...holesky, packages: up("ethchain-geth.public.dappnode.eth") })).toContain("no-execution-client");
      expect(ids({ ...holesky, packages: up("holesky-geth.avado.dnp.dappnode.eth") })).not.toContain("no-execution-client");
    });

    it("gnosis needs nethermind-gnosis", () => {
      const gnosis = { network: "gnosis" as const, settings: { ...base.settings, network: "gnosis", execution_engine: "nethermind-gnosis.avado.dnp.dappnode.eth" } };
      expect(ids({ ...gnosis, packages: [] })).toContain("no-execution-client");
      expect(ids({ ...gnosis, packages: up("nethermind-gnosis.avado.dnp.dappnode.eth") })).toEqual([]);
    });

    it("links a single-candidate network straight to that client's store page", () => {
      const gnosis = { network: "gnosis" as const, settings: { ...base.settings, network: "gnosis", execution_engine: undefined } };
      const p = one({ ...gnosis, packages: [] }, "no-execution-client");
      expect(p.body).toContain("Install Nethermind");
      expect(p.action).toEqual({
        label: "Install Nethermind",
        href: "http://my.ava.do/#/installer/nethermind-gnosis.avado.dnp.dappnode.eth",
      });
    });

    it("says nothing about installs on a network without a known candidate list", () => {
      const hoodi = { network: "hoodi" as const, settings: { ...base.settings, network: "hoodi", execution_engine: undefined } };
      expect(ids({ ...hoodi, packages: [] })).not.toContain("no-execution-client");
    });

    it("flags a chosen execution client that is not installed when another one is, linking to settings", () => {
      const p = one(
        { settings: { ...base.settings, execution_engine: "avado-dnp-nethermind.public.dappnode.eth" } },
        "execution-client-not-installed",
      );
      expect(p.tone).toBe("warning");
      expect(p.body).toBe("Nimbus is set to use Nethermind, which is not installed. Choose Geth in settings.");
      expect(p.body).not.toContain("dappnode.eth");
      expect(p.action).toEqual({ label: "Choose in settings", to: "/settings" });
      expect(ids({ settings: { ...base.settings, execution_engine: "avado-dnp-nethermind.public.dappnode.eth" } })).not.toContain(
        "no-execution-client",
      );
    });

    it("flags an unreachable execution client (el_offline) with a link to its package", () => {
      const p = one({ elOffline: true }, "execution-client-offline");
      expect(p.title).toBe("Execution client not reachable");
      expect(p.body).toContain("can't reach Geth");
      expect(p.action).toEqual({ label: "Open Geth", href: "http://my.ava.do/#/packages/ethchain-geth.public.dappnode.eth" });
    });

    describe("stopped execution client", () => {
      it("an installed but stopped execution client is stopped, not missing", () => {
        const packages = [...up("nimbus.avado.dnp.dappnode.eth"), ...down("ethchain-geth.public.dappnode.eth")];
        expect(ids({ packages })).toEqual(["execution-client-stopped"]);
        const p = one({ packages }, "execution-client-stopped");
        expect(p.tone).toBe("danger");
        expect(p.title).toBe("Geth is stopped");
        expect(p.action).toEqual({ label: "Open Geth", href: "http://my.ava.do/#/packages/ethchain-geth.public.dappnode.eth" });
      });

      it("uses the chosen engine: chosen Geth stopped while Nethermind runs is still a problem", () => {
        const packages = [...down("ethchain-geth.public.dappnode.eth"), ...up("avado-dnp-nethermind.public.dappnode.eth")];
        expect(ids({ packages })).toEqual(["execution-client-stopped"]);
      });

      it("without a chosen engine, one running candidate is enough", () => {
        const settings = { ...base.settings, execution_engine: undefined };
        const packages = [...down("ethchain-geth.public.dappnode.eth"), ...up("avado-dnp-nethermind.public.dappnode.eth")];
        expect(ids({ settings, packages })).toEqual([]);
        expect(ids({ settings, packages: down("ethchain-geth.public.dappnode.eth", "avado-dnp-nethermind.public.dappnode.eth") })).toEqual([
          "execution-client-stopped",
        ]);
      });

      it("a stopped client explains el_offline, so only the stopped banner shows", () => {
        expect(ids({ packages: down("ethchain-geth.public.dappnode.eth"), elOffline: true })).toEqual(["execution-client-stopped"]);
      });
    });

    it("shows only the install banner when nothing is installed, even if el_offline", () => {
      expect(ids({ packages: [], elOffline: true })).toEqual(["no-execution-client"]);
    });
  });

  describe("network", () => {
    it("says Prater is shut down", () => {
      const p = one({ network: "prater", settings: { ...base.settings, network: "prater", execution_engine: undefined }, packages: null }, "testnet");
      expect(p.tone).toBe("warning");
      expect(p.body).toContain("has been shut down");
    });

    it.each([["holesky"], ["hoodi"]] as const)("shows a testnet notice on %s", (network) => {
      const p = one({ network, settings: { ...base.settings, network, execution_engine: undefined }, packages: null }, "testnet");
      expect(p.tone).toBe("accent");
      expect(p.action.href).toBe("http://my.ava.do/#/installer");
    });

    it.each([["mainnet"], ["gnosis"]] as const)("no testnet notice on %s", (network) => {
      expect(ids({ network, settings: { ...base.settings, network }, packages: null })).not.toContain("testnet");
    });

    it("flags an unknown network in the settings", () => {
      const p = one({ settings: { ...base.settings, network: "sepolia" } }, "unknown-network");
      expect(p.tone).toBe("danger");
      expect(p.body).toContain("sepolia");
      expect(p.action.href).toBe("http://my.ava.do/#/packages/nimbus.avado.dnp.dappnode.eth");
    });

    it("flags settings for a different network than this package", () => {
      const p = one({ settings: { ...base.settings, network: "holesky" } }, "unknown-network");
      expect(p.body).toContain("Holesky");
      expect(p.body).toContain("Mainnet");
      expect(p.body).toContain("Restart the package");
      expect(p.body).toContain("contact AVADO support");
    });

    it("ignores a settings file without a network field", () => {
      expect(ids({ settings: { ...base.settings, network: undefined } })).toEqual([]);
    });
  });

  describe("wrong configuration", () => {
    it("flags config problems, lists them, and links to the package in the Admin", () => {
      const p = one({ configProblems: ["client-config.json is missing (HTTP 404)"] }, "wrong-config");
      expect(p.tone).toBe("danger");
      expect(p.title).toBe("Wrong configuration");
      expect(p.details).toEqual(["client-config.json is missing (HTTP 404)"]);
      expect(p.action).toEqual({ label: "Open the package", href: "http://my.ava.do/#/packages/nimbus.avado.dnp.dappnode.eth" });
    });
  });

  it("orders problems by severity: configuration, execution client, fee recipient, testnet", () => {
    expect(
      ids({
        network: "holesky",
        configProblems: ["x"],
        settings: { network: "holesky", validators_proposer_default_fee_recipient: "" },
        packages: [],
      }),
    ).toEqual(["wrong-config", "no-execution-client", "fee-recipient", "testnet"]);
  });

  it("every problem has a fix action with a label and exactly one target", () => {
    const all = findProblems({
      ...base,
      network: "holesky",
      configProblems: ["x"],
      settings: { network: "sepolia", validators_proposer_default_fee_recipient: "" },
      packages: [],
    });
    expect(all.length).toBeGreaterThanOrEqual(4);
    for (const p of all) {
      expect(p.action.label).toBeTruthy();
      expect(Boolean(p.action.to) !== Boolean(p.action.href)).toBe(true);
    }
  });
});
