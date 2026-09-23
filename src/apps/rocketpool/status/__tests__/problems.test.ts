import { DEMO, SCENARIOS, demoKey, reconcileView } from "../../api/fixtures";
import type { AvadoStatus, NodeStatus, ReconcileView } from "../../api/models";
import { findNodeProblems, findPendingProblems, findStatusProblems } from "../problems";
import type { PendingTx } from "../../tx/pending";

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

  it("mixed node: a key waiting for the owner's approval, most serious first", () => {
    const s = SCENARIOS.mixed;
    const p = findStatusProblems({ avado: s.avado, reconcile: s.reconcile });
    expect(ids(p)).toEqual(["legacy-mnemonic", "keys-awaiting-approval"]);
    expect(p[1].title).toBe("1 validator key needs your approval");
    expect(p[1].body).toBe(
      "It is not loaded in Teku yet. Load it only if this validator is not running anywhere else: running a key on two machines gets it slashed.",
    );
    expect(p[1].action).toEqual({ label: "Review keys", to: "/" });
  });

  const TEKU = { id: "teku", name: "Teku", package: "teku.avado.dnp.dappnode.eth" };
  const k = (n: number, state: Parameters<typeof demoKey>[3]) =>
    ({ ...demoKey(String(n).repeat(96).slice(0, 96), "megapool", String(n), state, "megapool", DEMO.megapool) });
  const view = (o: Parameters<typeof reconcileView>[0], patch: Record<string, unknown> = {}): ReconcileView => {
    const v = reconcileView(o);
    return { ...v, status: { ...(v.status as object), ...patch } };
  };

  it("plural approval banner", () => {
    const p = findStatusProblems({ avado: running, reconcile: view({ state: "attention", client: TEKU, keys: [k(1, "awaiting-approval"), k(2, "awaiting-approval")] }) });
    expect(p.map((x) => x.title)).toEqual(["2 validator keys need your approval"]);
    expect(p[0].body).toMatch(/^They are not loaded in Teku yet. Load them only if these validators are not running anywhere else/);
  });

  it("no client: the loop's own explanation of the client choice", () => {
    const why = 'Rocket Pool is set to use Lighthouse (CONSENSUSCLIENT=lighthouse), but the lighthouse.avado.dnp.dappnode.eth package is not installed.';
    const p = findStatusProblems({
      avado: running,
      reconcile: view({ state: "error", client: null, keys: [] }, { clientChoice: { source: "none", why } }),
    });
    expect(ids(p)).toEqual(["no-consensus-client"]);
    expect(p[0].body).toContain(why);
    expect(p[0].action.href).toBe("http://my.ava.do/#/installer");
  });

  it("keys loaded in another client, or blocked because another client can't be checked", () => {
    const elsewhere = { ...k(1, "elsewhere"), loadedIn: ["eth2validator.avado.dnp.dappnode.eth"] };
    const p = findStatusProblems({ avado: running, reconcile: view({ state: "attention", client: TEKU, keys: [k(0, "loaded"), elsewhere] }) });
    expect(ids(p)).toEqual(["keys-not-loaded"]);
    expect(p[0].title).toBe("1 validator key not running in Teku");
    expect(p[0].body).toMatch(/loaded in eth2validator.avado.dnp.dappnode.eth instead.*slashed/);

    const blocked = findStatusProblems({
      avado: running,
      reconcile: view(
        { state: "attention", client: TEKU, keys: [k(1, "import-blocked"), k(2, "import-blocked")] },
        { errors: ["Keys were not imported: the keys in Prysm could not be checked."] },
      ),
    });
    expect(blocked[0].title).toBe("2 validator keys not running in Teku");
    expect(blocked[0].body).toMatch(/could not be checked, so nothing was loaded into Teku/);
    expect(blocked[0].details).toEqual(["Keys were not imported: the keys in Prysm could not be checked."]);
    expect(blocked).toHaveLength(1); // the errors are not repeated in a second banner
  });

  it("fee recipients that could not be set; a pass that could not run; other errors", () => {
    const fee = findStatusProblems({
      avado: running,
      reconcile: view({ state: "attention", client: TEKU, keys: [k(0, "loaded")] }, { feeRecipients: { total: 1, ok: 0, fixed: 0, failed: 1 } }),
    });
    expect(fee.map((x) => x.title)).toEqual(["Fee recipient could not be set for 1 validator"]);

    const failed = findStatusProblems({
      avado: running,
      reconcile: view(
        { state: "error", client: TEKU, keys: [], message: "Could not read the validator keys from Teku. Is it running?" },
        { errors: ["Teku keymanager: connect ECONNREFUSED"] },
      ),
    });
    expect(ids(failed)).toEqual(["reconcile-failed"]);
    expect(failed[0].tone).toBe("danger");
    expect(failed[0].body).toBe("Could not read the validator keys from Teku. Is it running?");
    expect(failed[0].details).toEqual(["Teku keymanager: connect ECONNREFUSED"]);

    const other = findStatusProblems({
      avado: running,
      reconcile: view({ state: "attention", client: TEKU, keys: [k(0, "loaded")] }, { errors: ["More keys to import; the next check continues."] }),
    });
    expect(ids(other)).toEqual(["reconcile-errors"]);
  });

  it("a key loaded in two clients: a red banner, first, also while the daemon isn't ready", () => {
    const twice = { ...k(1, "loaded-twice"), loadedIn: ["nimbus.avado.dnp.dappnode.eth", "teku.avado.dnp.dappnode.eth"] };
    const r = view({ state: "error", client: TEKU, keys: [twice, k(2, "awaiting-approval")] }, { message: "Validator 0x… is loaded in both Nimbus and Teku — this can get it slashed." });
    const p = findStatusProblems({ avado: with_({ legacyMnemonicPresent: true }), reconcile: r });
    expect(ids(p)).toEqual(["keys-loaded-twice", "legacy-mnemonic", "keys-awaiting-approval"]);
    expect(p[0]).toMatchObject({ tone: "danger", title: "A validator key is loaded in two clients — this can get it slashed" });
    expect(p[0].details).toEqual([`0x11111111…1111: nimbus.avado.dnp.dappnode.eth and teku.avado.dnp.dappnode.eth`]);
    // Not hidden by a daemon that isn't ready.
    expect(ids(findStatusProblems({ avado: with_({ apiReachable: false }), reconcile: r }))).toEqual(["keys-loaded-twice", "daemon-starting"]);
    // Nor by a "waiting" pass.
    expect(ids(findStatusProblems({ avado: running, reconcile: view({ state: "waiting", client: TEKU, keys: [twice] }) }))).toEqual([
      "keys-loaded-twice",
    ]);
    const two = findStatusProblems({ avado: running, reconcile: view({ state: "error", client: TEKU, keys: [twice, { ...twice, pubkey: "3".repeat(96) }] }) });
    expect(two[0].title).toBe("2 validator keys are loaded in two clients — this can get them slashed");
  });

  it("approval shows why approved keys can't load right now; settling keys are announced, not warned about", () => {
    const p = findStatusProblems({
      avado: running,
      reconcile: view(
        { state: "attention", client: TEKU, keys: [k(1, "awaiting-approval"), k(2, "settling")] },
        { importBlockedReasons: ["The keys in Prysm could not be checked."] },
      ),
    });
    expect(ids(p)).toEqual(["keys-awaiting-approval", "keys-settling"]);
    expect(p[0].details).toEqual(["The keys in Prysm could not be checked."]);
    expect(p[1]).toMatchObject({ tone: "accent", title: "1 validator key will be loaded soon" });
  });

  it("an old client and unknown key states count as not running", () => {
    const p = findStatusProblems({
      avado: running,
      reconcile: view(
        { state: "attention", client: TEKU, keys: [k(1, "client-update-needed")] },
        { importBlockedReasons: ["Update Teku before loading keys."] },
      ),
    });
    expect(p[0].title).toBe("1 validator key not running in Teku");
    expect(p[0].body).toMatch(/^Update Teku from the AVADO Admin/);
    expect(p[0].details).toEqual(["Update Teku before loading keys."]);

    const unknown = view({ state: "attention", client: TEKU, keys: [k(1, "loaded")] }, {});
    (unknown.status as { validators: Array<{ state: string }> }).validators[0].state = "quarantined";
    expect(findStatusProblems({ avado: running, reconcile: unknown })[0].title).toBe("1 validator key not running in Teku");
  });

  it("a newer status version with nothing this UI understands still asks the owner to check", () => {
    const r = view({ state: "attention", client: TEKU, keys: [k(1, "loaded")] }, { version: 3, state: "degraded", message: "Something new." });
    const p = findStatusProblems({ avado: running, reconcile: r });
    expect(ids(p)).toEqual(["reconcile-newer"]);
    expect(p[0].body).toBe("Something new.");
  });

  it("says nothing while the loop waits (no wallet, starting, syncing), or while the daemon isn't ready, or for a garbled file", () => {
    expect(findStatusProblems({ avado: running, reconcile: view({ state: "waiting", client: null, keys: [] }) })).toEqual([]);
    const bad = view({ state: "attention", client: TEKU, keys: [k(1, "awaiting-approval")] });
    expect(ids(findStatusProblems({ avado: with_({ apiReachable: false }), reconcile: bad }))).toEqual(["daemon-starting"]);
    expect(findStatusProblems({ avado: running, reconcile: { ...bad, available: false } })).toEqual([]);
    expect(findStatusProblems({ avado: running, reconcile: reconcile("garbage") })).toEqual([]);
    expect(findStatusProblems({ avado: running, reconcile: reconcile({ state: "sideways" }) })).toEqual([]);
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

describe("pending transaction banners", () => {
  const entry = (patch: Partial<PendingTx>): PendingTx => ({
    key: "k",
    title: "Distribute your rewards",
    route: "node/distribute",
    params: {},
    page: "/rewards",
    state: "sent",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  });
  const HASH = `0x${"ab".repeat(32)}`;

  it("one on its way links the explorer; an unclear one warns and links back to its page", () => {
    const p = findPendingProblems([entry({ txHash: HASH }), entry({ key: "u", title: "Claim rewards", state: "unknown" })]);
    expect(p.map((x) => [x.id, x.tone, x.title])).toEqual([
      ["tx-unclear", "warning", "Check your transaction: Claim rewards"],
      ["tx-on-its-way", "accent", "Transaction on its way: Distribute your rewards"],
    ]);
    expect(p[0].action).toEqual({ label: "Open", to: "/rewards" });
    expect(p[1].action).toEqual({ label: "View on Etherscan", href: `https://etherscan.io/tx/${HASH}` });
  });

  it("several are summed up; finished ones say nothing", () => {
    const p = findPendingProblems([entry({ key: "a", state: "lost", txHash: HASH }), entry({ key: "b", state: "unknown", title: "Stake RPL" })]);
    expect(p[0].title).toBe("2 transactions need checking");
    expect(p[0].details).toEqual(["Distribute your rewards", "Stake RPL"]);
    expect(findPendingProblems([entry({ state: "done" }), entry({ key: "f", state: "failed" })])).toEqual([]);
  });
});
