import { QtumApiError } from "../../api/errors";
import type { StakingInfo, WalletStatus } from "../../api/models";
import type { NodeInfo, WalletSummary } from "../../api/node";
import { describeNode } from "../nodeState";
import { stakingView } from "../staking";

const ready = { state: "ready" } as WalletStatus;
const node: NodeInfo = { blocks: 10, headers: 10, progress: 1, syncing: false, peers: 8, version: "30.2.0" };
const wallet: WalletSummary = { available: 100, pending: 0, inStake: 0, immature: 0, total: 100, encrypted: false, unlocked: false };
const staking: StakingInfo = { enabled: true, staking: false, errors: "", weight: 1e10, netstakeweight: 1e15, expectedtime: 0 };

describe("staking in plain words", () => {
  const view = (over: { walletStatus?: WalletStatus; node?: Partial<NodeInfo>; wallet?: Partial<WalletSummary>; staking?: Partial<StakingInfo> }) =>
    stakingView({
      walletStatus: over.walletStatus ?? ready,
      node: { ...node, ...over.node },
      wallet: { ...wallet, ...over.wallet },
      staking: { ...staking, ...over.staking },
    });

  it("staking, with the expected time", () => {
    const v = view({ staking: { staking: true, expectedtime: 5 * 3600 } });
    expect(v).toMatchObject({ reason: "staking", tone: "success", label: "Staking", expected: "about 5 hours" });
    expect(view({ staking: { staking: true, expectedtime: 0 } }).expected).toBeUndefined();
  });

  it("each reason it does not stake, most important first", () => {
    expect(view({ walletStatus: { state: "migrating" } as WalletStatus }).reason).toBe("wallet-not-ready");
    expect(view({ node: { syncing: true } }).reason).toBe("syncing");
    expect(view({ staking: { enabled: false } }).reason).toBe("disabled");
    expect(view({ wallet: { encrypted: true, unlocked: false } }).reason).toBe("locked");
    expect(view({ wallet: { total: 0 } }).reason).toBe("no-coins");
    expect(view({ staking: { weight: 0 } }).reason).toBe("no-mature-coins");
    expect(view({}).reason).toBe("waiting");
  });

  it("checking while nothing is loaded", () => {
    expect(stakingView({ walletStatus: ready, node: undefined, wallet: undefined, staking: undefined }).reason).toBe("checking");
  });
});

describe("the node state for the strip", () => {
  const starting = new QtumApiError({ kind: "rpc", path: "rpc getblockchaininfo", code: -28 });
  it("running, syncing, starting, stopped, not reachable", () => {
    expect(describeNode({ node, nodeError: undefined, walletStatus: ready, packageDown: false })).toMatchObject({ label: "Running", tone: "success" });
    expect(describeNode({ node: { ...node, syncing: true, blocks: 5, progress: 0.5 }, nodeError: undefined, walletStatus: ready, packageDown: false }).label).toBe(
      "Syncing 50.00%",
    );
    expect(describeNode({ node: undefined, nodeError: starting, walletStatus: ready, packageDown: false }).label).toBe("Starting");
    expect(describeNode({ node: undefined, nodeError: starting, walletStatus: { state: "stopped" } as WalletStatus, packageDown: false }).label).toBe("Stopped");
    expect(describeNode({ node: undefined, nodeError: undefined, walletStatus: undefined, packageDown: true }).label).toBe("Can't connect");
    expect(describeNode({ node: undefined, nodeError: undefined, walletStatus: undefined, packageDown: false }).label).toBe("Checking");
    expect(
      describeNode({ node, nodeError: new QtumApiError({ kind: "rpc", path: "rpc x", code: -1 }), walletStatus: ready, packageDown: false }).label,
    ).toBe("Not answering");
  });
});
