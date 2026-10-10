import { DEMO, SCENARIOS, demoKey, reconcileView } from "../../api/fixtures";
import type { AvadoStatus, NodeStatus, ReconcileView } from "../../api/models";
import { findNodeProblems, findPendingProblems, findStatusProblems, forMode } from "../problems";
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
    // The startup error in plain words: the internal URL is left out of the banner.
    expect(p[0].body).toContain("could not load its settings: the execution client URL does not answer.");
    expect(p[0].body).not.toContain("http://");
    // Simple mode: no log lines, and a step the owner can take; Advanced: the raw error and the log lines, and the logs page.
    const simple = forMode(p[0], false);
    expect(simple.details ?? []).toEqual([]);
    expect(simple.action).toEqual({ label: "Open the package", href: "http://my.ava.do/#/packages/rocketpool.avado.dnp.dappnode.eth" });
    const advanced = forMode(p[0], true);
    expect(advanced.details).toHaveLength(3);
    expect(advanced.details?.[0]).toContain("http://ethchain-geth.my.ava.do:8545");
    expect(advanced.action).toEqual({ label: "See the logs", to: "/advanced" });
  });

  it("a stopped daemon without a startup error", () => {
    for (const state of ["FATAL", "BACKOFF", "EXITED", "STOPPED"]) {
      const p = findStatusProblems({ avado: with_({ daemon: { state }, apiReachable: false, daemonErrors: ["a", "b", "c", "d"] }) });
      expect(ids(p)).toEqual(["daemon-stopped"]);
      expect(forMode(p[0], true).details).toEqual(["b", "c", "d"]);
      expect(forMode(p[0], false).details ?? []).toEqual([]);
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
    // Explained and moved away on Home (typed ARCHIVE).
    expect(p[0].action).toEqual({ label: "Fix this", to: "/" });
  });

  it("mixed node: a key waiting for the owner's approval, most serious first", () => {
    const s = SCENARIOS.mixed;
    const p = findStatusProblems({ avado: s.avado, reconcile: s.reconcile });
    expect(ids(p)).toEqual(["legacy-mnemonic", "keys-awaiting-approval"]);
    expect(p[1].title).toBe("1 validator key needs your approval");
    expect(p[1].body).toBe(
      "It is not running in Teku yet. Start it only if this validator is not running anywhere else: running a key on two machines gets it slashed (a heavy penalty).",
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
    expect(p[0].body).toMatch(/^They are not running in Teku yet. Start them only if these validators are not running anywhere else/);
  });

  it("no client because the pass failed before choosing one: the failure, not a missing client", () => {
    const p = findStatusProblems({
      avado: running,
      reconcile: view({ state: "error", client: null, keys: [] }, { clientChoice: null, errors: ["Rocket Pool daemon (node/status): HTTP 500"] }),
    });
    expect(ids(p)).toEqual(["reconcile-failed"]);
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
    expect(blocked[0].body).toMatch(/couldn't be checked, so to be safe nothing was loaded into Teku/);
    // The key check's own error text is a detail for Advanced mode; Simple mode offers support instead of the Advanced page.
    expect(forMode(blocked[0], true).details).toEqual(["Keys were not imported: the keys in Prysm could not be checked."]);
    expect(forMode(blocked[0], false).details).toEqual([]);
    expect(forMode(blocked[0], false).action).toEqual({ label: "Contact AVADO support", href: "mailto:support@ava.do" });
    expect(blocked).toHaveLength(1); // the errors are not repeated in a second banner
  });

  it("fee recipients that could not be set; a pass that could not run; other errors", () => {
    const fee = findStatusProblems({
      avado: running,
      reconcile: view({ state: "attention", client: TEKU, keys: [k(0, "loaded")] }, { feeRecipients: { total: 1, ok: 0, fixed: 0, failed: 1 } }),
    });
    expect(fee.map((x) => x.title)).toEqual(["Block rewards may go to the wrong address for 1 validator"]);
    expect(fee[0].body).toContain('(the "fee recipient")');

    const failed = findStatusProblems({
      avado: running,
      reconcile: view(
        { state: "error", client: TEKU, keys: [], message: "Could not read the validator keys from Teku. Is it running?" },
        { errors: ["Teku keymanager: connect ECONNREFUSED"] },
      ),
    });
    expect(ids(failed)).toEqual(["reconcile-failed"]);
    expect(failed[0].tone).toBe("danger");
    expect(failed[0].body).toMatch(/^Every few minutes Rocket Pool checks that your validators run in Teku\. The last check failed/);
    expect(forMode(failed[0], true).details).toEqual(["Could not read the validator keys from Teku. Is it running?", "Teku keymanager: connect ECONNREFUSED"]);
    expect(forMode(failed[0], false).details ?? []).toEqual([]);

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
    expect(p[1]).toMatchObject({ tone: "accent", title: "1 validator key will start soon" });
    expect(forMode(p[1], false).action).toEqual({ label: "See on Home", to: "/" });
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
    expect(p[0].body).toMatch(/^Update Teku in the AVADO Admin/);
    expect(forMode(p[0], false).action).toEqual({ label: "Open Teku", href: "http://my.ava.do/#/packages/teku.avado.dnp.dappnode.eth" });
    expect(p[0].details).toEqual(["Update Teku before loading keys."]);

    const unknown = view({ state: "attention", client: TEKU, keys: [k(1, "loaded")] }, {});
    (unknown.status as { validators: Array<{ state: string }> }).validators[0].state = "quarantined";
    expect(findStatusProblems({ avado: running, reconcile: unknown })[0].title).toBe("1 validator key not running in Teku");
  });

  it("a newer status version with nothing this UI understands still asks the owner to check", () => {
    const r = view({ state: "attention", client: TEKU, keys: [k(1, "loaded")] }, { version: 3, state: "degraded", message: "Something new." });
    const p = findStatusProblems({ avado: running, reconcile: r });
    expect(ids(p)).toEqual(["reconcile-newer"]);
    expect(p[0].body).toBe("Rocket Pool reported something this page can't show yet. Reload the page; if this stays, contact AVADO support.");
    expect(forMode(p[0], true).details).toEqual(["Something new."]);
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
    expect(p[0]).toMatchObject({ title: "Your withdrawal address is still the node wallet", action: { to: "/setup/withdrawal" } });
    expect(p[1].body).toContain("0.0061 ETH");
    expect(p[1].action).toEqual({ label: "Add ETH", to: "/setup/fund" });
  });

  it("a new withdrawal address waiting for its confirmation says how to confirm it", () => {
    const p = findNodeProblems(node({ pendingPrimaryWithdrawalAddress: DEMO.coldWallet }, "mixed"));
    expect(p[0]).toMatchObject({
      id: "withdrawal-is-hot-wallet",
      title: "Confirm your new withdrawal address",
      action: { label: "How to confirm", to: "/setup/withdrawal" },
    });
    expect(p[0].body).toContain(`${DEMO.coldWallet.slice(0, 6)}…`);
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
    // Not mined for an hour: needs checking, not "on its way".
    expect(findPendingProblems([entry({ txHash: HASH })], () => true).map((x) => x.id)).toEqual(["tx-unclear"]);
  });
});
