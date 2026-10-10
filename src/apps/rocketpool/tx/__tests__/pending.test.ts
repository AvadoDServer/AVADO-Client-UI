import { createMockRocketpoolApi } from "../../api/mock";
import { DISMISS_AFTER_MS, LOCK_ALIASES, OVERDUE_AFTER_MS, PENDING_STORAGE_KEY, PendingTxStore, pendingKey } from "../pending";

/** An in-memory Storage (one per test; a "reload" is a new store on the same storage). */
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const HASH = `0x${"ab".repeat(32)}`;
const input = (params = { address: "0x1" }) => ({ key: pendingKey("node/distribute", params), title: "Distribute", route: "node/distribute", params, page: "/rewards" });
const waits = (api: ReturnType<typeof createMockRocketpoolApi>) => api.calls.filter((c) => c.path === "/api/sn/wait");
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("pending transactions", () => {
  it("I7: locks by route; only a target (minipool address, validator) splits it — never amounts, salts or fees", () => {
    expect(pendingKey("node/deposit", { amountWei: "4000000000000000000", salt: "1", count: 1 })).toBe("node/deposit");
    expect(pendingKey("node/deposit", { amountWei: "8000000000000000000", salt: "2", count: 2 })).toBe("node/deposit");
    expect(pendingKey("node/stake-rpl", { amountWei: "1" })).toBe(pendingKey("node/stake-rpl", { amountWei: "999" }));
    expect(pendingKey("minipool/exit", { address: "0xAA" })).toBe(pendingKey("minipool/exit", { address: "0xaa" }));
    expect(pendingKey("minipool/exit", { address: "0xaa" })).not.toBe(pendingKey("minipool/exit", { address: "0xbb" }));
    expect(pendingKey("megapool/exit-validator", { validatorId: 1, maxFee: "2" })).toBe(pendingKey("megapool/exit-validator", { validatorId: 1 }));
    expect(pendingKey("megapool/exit-validator", { validatorId: 1 })).not.toBe(pendingKey("megapool/exit-validator", { validatorId: 2 }));
    expect(pendingKey("megapool/exit-queue", { validatorIndex: 7 })).not.toBe(pendingKey("megapool/exit-queue", { validatorIndex: 8 }));
  });

  it("M12: one spelling per target; claim-and-stake shares the claim's lock; staking RPL has one lock whatever the amount", () => {
    expect(pendingKey("megapool/exit-validator", { validatorId: "007" })).toBe(pendingKey("megapool/exit-validator", { validatorId: 7 }));
    expect(pendingKey("megapool/exit-validator", { validatorId: " 7 " })).toBe(pendingKey("megapool/exit-validator", { validatorId: "7" }));
    expect(pendingKey("node/stake-rpl", { amountWei: "5", approvalTxHash: HASH })).toBe(pendingKey("node/stake-rpl", { amountWei: "9" }));
    expect(pendingKey("node/stake-rpl-approve-rpl")).not.toBe("node/stake-rpl");
    // The backend no longer allows wait-and-stake-rpl: no alias for it.
    expect(LOCK_ALIASES).toEqual({ "node/claim-and-stake-rewards": "node/claim-rewards" });
    // Claiming and claiming-and-staking the same reward periods is one action.
    expect(pendingKey("node/claim-and-stake-rewards", { indices: "42,43", stakeAmount: "1" })).toBe(pendingKey("node/claim-rewards", { indices: "42,43" }));
    const store = new PendingTxStore({ api: createMockRocketpoolApi(), storage: null });
    expect(store.begin({ key: pendingKey("node/stake-rpl", { amountWei: "2" }), title: "Stake", route: "node/stake-rpl", params: {} })).toBe(true);
    expect(store.begin({ key: pendingKey("node/stake-rpl", { amountWei: "1" }), title: "Stake", route: "node/stake-rpl", params: {} })).toBe(false);
  });

  it("an off-chain action (a signed exit) is finished at once: done in memory, gone from storage, unlocked after it's seen", () => {
    const storage = memoryStorage();
    const store = new PendingTxStore({ api: createMockRocketpoolApi(), storage });
    const key = pendingKey("minipool/exit", { address: "0xa" });
    const exit = { key, title: "Exit", route: "minipool/exit", params: { address: "0xa" }, page: "/validators" };
    store.markFinished(key); // nothing to finish yet
    expect(store.get(key)).toBeUndefined();
    expect(store.begin(exit)).toBe(true);
    expect(storage.data.has(PENDING_STORAGE_KEY)).toBe(true);
    store.markFinished(key);
    expect(store.get(key)?.state).toBe("done");
    expect(store.isBlocking(key)).toBe(false);
    expect(storage.data.has(PENDING_STORAGE_KEY)).toBe(false);
    expect(store.dismiss(key)).toBe(true);
    expect(store.begin(exit)).toBe(true);
    // An entry that is not sending (e.g. unclear) is never marked done.
    store.markUnknown(key, "No answer");
    store.markFinished(key);
    expect(store.get(key)?.state).toBe("unknown");
  });

  it("records before sending and refuses the same action while it's in flight, saved in storage", () => {
    const storage = memoryStorage();
    const store = new PendingTxStore({ api: createMockRocketpoolApi(), storage });
    const exit = (address: string) => ({ key: pendingKey("minipool/exit", { address }), title: "Exit", route: "minipool/exit", params: { address }, page: "/validators" });
    expect(store.begin(input())).toBe(true);
    expect(JSON.parse(storage.data.get(PENDING_STORAGE_KEY)!)[0]).toMatchObject({ state: "sending", route: "node/distribute", page: "/rewards" });
    expect(store.begin(input())).toBe(false);
    expect(store.begin(input({ address: "0x2" }))).toBe(false); // same route, other params: still the same action
    expect(store.begin(exit("0xa"))).toBe(true);
    expect(store.begin(exit("0xb"))).toBe(true); // another minipool
    // A refused send frees it again.
    store.markNotSent(input().key);
    expect(store.begin(input())).toBe(true);
  });

  it("a reload during a send leaves it unclear (never silently sendable), and it stays locked", () => {
    const storage = memoryStorage();
    new PendingTxStore({ api: createMockRocketpoolApi(), storage }).begin(input());
    const reloaded = new PendingTxStore({ api: createMockRocketpoolApi(), storage });
    expect(reloaded.get(input().key)).toMatchObject({ state: "unknown", message: expect.stringMatching(/closed or reloaded/) });
    expect(reloaded.begin(input())).toBe(false);
  });

  it("follows a sent tx with one wait, resumes it after a reload, and ends it when mined (calling onDone)", async () => {
    const storage = memoryStorage();
    const api = createMockRocketpoolApi({ scenario: "minipool", waitMs: 60_000 });
    const store = new PendingTxStore({ api, storage });
    store.start();
    store.begin(input());
    store.markSent(input().key, HASH);
    store.follow(input().key); // already followed: no second wait
    store.follow(input().key);
    await flush();
    expect(waits(api)).toHaveLength(1);
    store.stop(); // the page goes away: the wait is cancelled, the entry kept

    const api2 = createMockRocketpoolApi({ scenario: "minipool", waitMs: 5 });
    const reloaded = new PendingTxStore({ api: api2, storage });
    const done = vi.fn();
    reloaded.onDone(input().key, done);
    expect(reloaded.get(input().key)?.state).toBe("sent");
    reloaded.start();
    await vi.waitFor(() => expect(reloaded.get(input().key)?.state).toBe("done"));
    expect(waits(api2).map((c) => c.params.txHash)).toEqual([HASH]);
    expect(done).toHaveBeenCalledWith(HASH);
    expect(storage.data.has(PENDING_STORAGE_KEY)).toBe(false); // done lives in memory only
    expect(reloaded.begin(input())).toBe(true); // and no longer blocks
  });

  it("a restarted wait cancels the previous one", async () => {
    const api = createMockRocketpoolApi({ scenario: "minipool", waitMs: 60_000 });
    const store = new PendingTxStore({ api, storage: memoryStorage() });
    store.begin(input());
    store.markSent(input().key, HASH);
    const signals: AbortSignal[] = [];
    const snGet = api.snGet.bind(api);
    api.snGet = ((route: string, params?: Record<string, string>, opts?: { signal?: AbortSignal }) => {
      if (route === "wait" && opts?.signal) signals.push(opts.signal);
      return snGet(route, params, opts);
    }) as typeof api.snGet;
    store.follow(input().key, { restart: true });
    store.follow(input().key, { restart: true });
    await flush();
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    store.stop();
    expect(signals[1].aborted).toBe(true);
  });

  it("a reverted tx fails; a lost wait keeps it locked", async () => {
    const reverting = new PendingTxStore({ api: createMockRocketpoolApi({ txOutcome: "revert" }), storage: memoryStorage() });
    reverting.begin(input());
    reverting.markSent(input().key, HASH);
    await vi.waitFor(() => expect(reverting.get(input().key)?.state).toBe("failed"));
    expect(reverting.isBlocking(input().key)).toBe(false);

    const losing = new PendingTxStore({ api: createMockRocketpoolApi({ failures: { wait: "timeout" } }), storage: memoryStorage() });
    losing.begin(input());
    losing.markSent(input().key, HASH);
    await vi.waitFor(() => expect(losing.get(input().key)?.state).toBe("lost"));
    expect(losing.isBlocking(input().key)).toBe(true);
  });

  it("an unclear send can be dismissed only after the age limit", () => {
    let t = 1_000_000;
    const store = new PendingTxStore({ api: createMockRocketpoolApi(), storage: memoryStorage(), now: () => t });
    store.begin(input());
    store.markUnknown(input().key, "No answer");
    expect(store.dismiss(input().key)).toBe(false);
    t += DISMISS_AFTER_MS - 1;
    expect(store.canDismiss(input().key)).toBe(false);
    t += 1;
    expect(store.dismiss(input().key)).toBe(true);
    expect(store.begin(input())).toBe(true);
  });

  it("ignores broken or foreign storage content, and works without storage", () => {
    const storage = memoryStorage();
    storage.setItem(PENDING_STORAGE_KEY, '[{"key":1},{"key":"k","route":"r","params":{},"state":"weird","createdAt":1},"x"]');
    expect(new PendingTxStore({ api: createMockRocketpoolApi(), storage }).list()).toEqual([]);
    storage.setItem(PENDING_STORAGE_KEY, "{not json");
    expect(new PendingTxStore({ api: createMockRocketpoolApi(), storage }).list()).toEqual([]);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    const store = new PendingTxStore({ api: createMockRocketpoolApi(), storage: throwing });
    expect(store.begin(input())).toBe(true);
    expect(store.begin(input())).toBe(false); // the in-memory guard still holds
  });

  it("M9: a clock set back, or a timestamp in the future, can't lock an action for good", () => {
    let wall = 5_000_000;
    let mono = 0;
    const store = new PendingTxStore({ api: createMockRocketpoolApi(), storage: memoryStorage(), now: () => wall, monotonic: () => mono });
    store.begin(input());
    store.markUnknown(input().key, "No answer");
    wall -= 3_600_000; // the clock goes back an hour
    mono += DISMISS_AFTER_MS - 1;
    expect(store.canDismiss(input().key)).toBe(false);
    mono += 1;
    expect(store.canDismiss(input().key)).toBe(true); // 10 minutes seen in this page is enough

    const storage = memoryStorage();
    storage.setItem(PENDING_STORAGE_KEY, JSON.stringify([{ ...input(), state: "unknown", createdAt: 1e15, updatedAt: 1e15 }]));
    let m = 0;
    const future = new PendingTxStore({ api: createMockRocketpoolApi(), storage, now: () => 5_000_000, monotonic: () => m });
    expect(future.canDismiss(input().key)).toBe(false);
    m = DISMISS_AFTER_MS;
    expect(future.canDismiss(input().key)).toBe(true);
  });

  it("M10: a tx another tab saw finish doesn't come back as unclear", async () => {
    const storage = memoryStorage();
    const api = createMockRocketpoolApi({ scenario: "minipool", waitMs: 5 });
    const tabA = new PendingTxStore({ api, storage });
    tabA.start();
    tabA.begin(input());
    const tabB = new PendingTxStore({ api: createMockRocketpoolApi(), storage }); // opened while A was sending
    expect(tabB.get(input().key)?.state).toBe("unknown");
    tabA.markSent(input().key, HASH);
    await vi.waitFor(() => expect(tabA.get(input().key)?.state).toBe("done"));
    expect(storage.data.has(PENDING_STORAGE_KEY)).toBe(false);
    // B writes something else: the finished tx must not be written back.
    tabB.begin({ ...input(), key: "other", route: "node/claim-rewards" });
    const saved = JSON.parse(storage.data.get(PENDING_STORAGE_KEY)!) as Array<{ key: string }>;
    expect(saved.map((e) => e.key)).toEqual(["other"]);
    expect(tabB.get(input().key)).toBeUndefined();
    tabA.stop();
  });

  it("M10: a late 'unknown' doesn't overrule a newer record from another tab", () => {
    const storage = memoryStorage();
    let t = 1_000;
    const tabA = new PendingTxStore({ api: createMockRocketpoolApi(), storage, now: () => t });
    tabA.begin(input());
    // Another tab recorded the hash for it meanwhile (newer).
    t = 2_000;
    storage.setItem(PENDING_STORAGE_KEY, JSON.stringify([{ ...input(), state: "sent", txHash: HASH, createdAt: 1_000, updatedAt: 2_000 }]));
    t = 3_000;
    tabA.markUnknown(input().key, "No answer");
    expect(tabA.get(input().key)).toMatchObject({ state: "sent", txHash: HASH });
    // Removed by another tab (it finished there): nothing is written back.
    storage.removeItem(PENDING_STORAGE_KEY);
    tabA.markUnknown(input().key, "No answer");
    expect(tabA.get(input().key)).toBeUndefined();
    expect(storage.data.has(PENDING_STORAGE_KEY)).toBe(false);
  });

  it("M11: a tx not mined for an hour isn't waited on again at every load; the owner keeps waiting or dismisses", async () => {
    const storage = memoryStorage();
    const now = 10 * OVERDUE_AFTER_MS;
    storage.setItem(
      PENDING_STORAGE_KEY,
      JSON.stringify([{ ...input(), state: "sent", txHash: HASH, createdAt: now - OVERDUE_AFTER_MS - 1, updatedAt: now - OVERDUE_AFTER_MS - 1, waitingSince: now - OVERDUE_AFTER_MS - 1 }]),
    );
    const api = createMockRocketpoolApi({ scenario: "minipool", waitMs: 60_000 });
    const store = new PendingTxStore({ api, storage, now: () => now, monotonic: () => 0 });
    store.start();
    await flush();
    expect(waits(api)).toHaveLength(0);
    expect(store.isOverdue(input().key)).toBe(true);
    expect(store.canDismiss(input().key)).toBe(true);
    expect(store.isBlocking(input().key)).toBe(true); // still locked until the owner decides

    store.keepWaiting(input().key);
    await flush();
    expect(waits(api)).toHaveLength(1);
    expect(store.isOverdue(input().key)).toBe(false); // a fresh hour
    expect(store.canDismiss(input().key)).toBe(false);
    expect(JSON.parse(storage.data.get(PENDING_STORAGE_KEY)!)[0].waitingSince).toBe(now);
    store.stop();

    // A recent tx on load is followed as before.
    const fresh = memoryStorage();
    fresh.setItem(PENDING_STORAGE_KEY, JSON.stringify([{ ...input(), state: "sent", txHash: HASH, createdAt: now - 60_000, updatedAt: now - 60_000, waitingSince: now - 60_000 }]));
    const api2 = createMockRocketpoolApi({ scenario: "minipool", waitMs: 60_000 });
    const store2 = new PendingTxStore({ api: api2, storage: fresh, now: () => now, monotonic: () => 0 });
    store2.start();
    await flush();
    expect(waits(api2)).toHaveLength(1);
    store2.stop();
  });

  it("sees an action started in another tab", () => {
    const storage = memoryStorage();
    const tabA = new PendingTxStore({ api: createMockRocketpoolApi(), storage });
    const tabB = new PendingTxStore({ api: createMockRocketpoolApi(), storage });
    expect(tabA.begin(input())).toBe(true);
    expect(tabB.begin(input())).toBe(false);
  });
});
