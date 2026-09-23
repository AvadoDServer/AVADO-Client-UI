import { SCENARIOS } from "../../api/fixtures";
import type { AvadoStatus, NodeStatus, ReconcileView } from "../../api/models";
import { findNodeProblems, findStatusProblems, parseReconcileStatus } from "../problems";

const running = SCENARIOS.minipool.avado;
const okReconcile = SCENARIOS.minipool.reconcile;
const ids = (p: { id: string }[]) => p.map((x) => x.id);
const with_ = (patch: Partial<AvadoStatus>): AvadoStatus => ({ ...running, ...patch });
const reconcile = (status: unknown): ReconcileView => ({ available: true, runRequested: false, status: status as ReconcileView["status"] });

describe("status banners", () => {
  it("none for a healthy node, and none before anything has loaded", () => {
    expect(findStatusProblems({ avado: running, reconcile: okReconcile })).toEqual([]);
    expect(findStatusProblems({})).toEqual([]);
  });

  it("the package not answering hides everything else (stale data can't be trusted)", () => {
    const p = findStatusProblems({ avado: SCENARIOS["daemon-failed"].avado, avadoFailed: true, reconcile: okReconcile });
    expect(ids(p)).toEqual(["backend-unreachable"]);
    expect(p[0].action.href).toBe("http://my.ava.do/#/packages/rocketpool.avado.dnp.dappnode.eth");
  });

  it("failed daemon: the startup error with the last log lines, and nothing about keys", () => {
    const s = SCENARIOS["daemon-failed"];
    const p = findStatusProblems({ avado: s.avado, reconcile: s.reconcile });
    expect(ids(p)).toEqual(["startup-error"]);
    expect(p[0]).toMatchObject({ tone: "danger", title: "Rocket Pool could not start", action: { to: "/advanced" } });
    expect(p[0].body).toContain("could not load its settings");
    expect(p[0].details).toHaveLength(2);
  });

  it("a stopped daemon without a startup error", () => {
    for (const state of ["FATAL", "BACKOFF", "EXITED", "STOPPED"]) {
      const p = findStatusProblems({ avado: with_({ daemon: { state }, apiReachable: false, daemonErrors: ["a", "b", "c", "d"] }) });
      expect(ids(p)).toEqual(["daemon-stopped"]);
      expect(p[0].details).toEqual(["b", "c", "d"]);
    }
  });

  it("starting: STARTING, or running without its API or token yet", () => {
    expect(ids(findStatusProblems({ avado: with_({ daemon: { state: "STARTING" }, apiReachable: false }) }))).toEqual(["daemon-starting"]);
    expect(ids(findStatusProblems({ avado: with_({ apiReachable: false }) }))).toEqual(["daemon-starting"]);
    expect(ids(findStatusProblems({ avado: with_({ apiTokenPresent: false }) }))).toEqual(["daemon-starting"]);
    expect(ids(findStatusProblems({ avado: with_({ daemon: { state: "UNKNOWN" } }) }))).toEqual([]);
  });

  it("unsupported network", () => {
    const p = findStatusProblems({ avado: with_({ network: "holesky", networkSupported: false }) });
    expect(ids(p)).toEqual(["network-unsupported"]);
    expect(p[0].body).toContain('"holesky"');
  });

  it("fresh node: set up, once the daemon is ready", () => {
    const s = SCENARIOS.fresh;
    const p = findStatusProblems({ avado: s.avado, reconcile: s.reconcile });
    expect(ids(p)).toEqual(["no-wallet"]);
    expect(p[0]).toMatchObject({ tone: "accent", action: { to: "/setup" } });
    expect(ids(findStatusProblems({ avado: { ...s.avado, apiReachable: false } }))).toEqual(["daemon-starting"]);
  });

  it("wallet without its password file; the old plaintext recovery phrase", () => {
    expect(ids(findStatusProblems({ avado: with_({ passwordFilePresent: false }) }))).toEqual(["password-missing"]);
    const p = findStatusProblems({ avado: with_({ legacyMnemonicPresent: true }) });
    expect(ids(p)).toEqual(["legacy-mnemonic"]);
    expect(p[0].action.to).toBe("/wallet");
  });

  it("mixed node: a key not running in Teku, with the loop's explanation, most serious first", () => {
    const s = SCENARIOS.mixed;
    const p = findStatusProblems({ avado: s.avado, reconcile: s.reconcile });
    expect(ids(p)).toEqual(["legacy-mnemonic", "keys-not-loaded"]);
    expect(p[1].title).toBe("1 validator key not running in Teku");
    expect(p[1].details).toEqual(["The key of megapool validator 2 is not ready yet: it is still in the deposit queue."]);
  });

  it("key check: no consensus client, keys in another client, wrong fee recipients, other errors", () => {
    expect(ids(findStatusProblems({ avado: running, reconcile: reconcile({ client: null, keys: { total: 2, loaded: 0 } }) }))).toEqual([
      "no-consensus-client",
    ]);
    // No keys yet and no client: nothing to warn about.
    expect(findStatusProblems({ avado: running, reconcile: reconcile({ client: null, keys: { total: 0, loaded: 0 } }) })).toEqual([]);

    const elsewhere = findStatusProblems({
      avado: running,
      reconcile: reconcile({ client: { package: "nimbus.avado.dnp.dappnode.eth", title: "Nimbus" }, keys: { total: 3, loaded: 1, inOtherClient: 2 } }),
    });
    expect(elsewhere[0].title).toBe("2 validator keys not running in Nimbus");
    expect(elsewhere[0].body).toMatch(/2 keys are already loaded in another consensus client.*double signing/);

    const fee = findStatusProblems({
      avado: running,
      reconcile: reconcile({ client: { package: "x", title: "Lighthouse" }, feeRecipients: { total: 2, correct: 1 }, errors: ["keymanager said 500"] }),
    });
    expect(ids(fee)).toEqual(["fee-recipient-wrong", "reconcile-errors"]);
    expect(fee[0].title).toBe("Wrong fee recipient for 1 validator");
    expect(fee[1].details).toEqual(["keymanager said 500"]);
  });

  it("ignores the key check while the daemon isn't ready, when unavailable, or garbled", () => {
    const bad = reconcile({ client: null, keys: { total: 2, loaded: 0 } });
    expect(findStatusProblems({ avado: with_({ apiReachable: false }), reconcile: bad }).map((p) => p.id)).toEqual(["daemon-starting"]);
    expect(findStatusProblems({ avado: running, reconcile: { ...bad, available: false } })).toEqual([]);
    expect(findStatusProblems({ avado: running, reconcile: reconcile("garbage") })).toEqual([]);
    expect(findStatusProblems({ avado: running, reconcile: reconcile({ keys: { total: "3", loaded: 1 } }) })).toEqual([]);
  });

  it("parses the status file field by field", () => {
    expect(parseReconcileStatus(null)).toBeUndefined();
    expect(
      parseReconcileStatus({
        lastRunAt: "2026-09-23T10:00:00Z",
        client: { package: "teku.avado.dnp.dappnode.eth" },
        keys: { total: 2, loaded: 2, imported: 1 },
        feeRecipients: { total: 2, correct: -1 },
        errors: ["a", 5, ""],
        extra: true,
      }),
    ).toEqual({
      lastRunAt: "2026-09-23T10:00:00Z",
      client: { package: "teku.avado.dnp.dappnode.eth", title: "teku.avado.dnp.dappnode.eth" },
      keys: { total: 2, loaded: 2, imported: 1 },
      errors: ["a"],
    });
  });
});

describe("node banners (for Home)", () => {
  const node = (patch: Partial<NodeStatus>, scenario: "minipool" | "mixed" = "minipool") =>
    ({ ...(SCENARIOS[scenario].reads["node/status"] as NodeStatus), ...patch }) as NodeStatus;

  it("mixed node: withdrawal address is the hot wallet, and little ETH for gas", () => {
    const p = findNodeProblems(node({}, "mixed"));
    expect(ids(p)).toEqual(["withdrawal-is-hot-wallet", "low-gas-balance"]);
    expect(p[1].body).toContain("0.0061 ETH");
  });

  it("none for the healthy minipool node, an unregistered node, or nothing loaded", () => {
    expect(findNodeProblems(node({}))).toEqual([]);
    expect(findNodeProblems(node({ registered: false }, "mixed"))).toEqual([]);
    expect(findNodeProblems(undefined)).toEqual([]);
  });
});
