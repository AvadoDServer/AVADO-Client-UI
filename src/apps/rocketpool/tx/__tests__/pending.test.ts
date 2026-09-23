import { createMockRocketpoolApi } from "../../api/mock";
import { DISMISS_AFTER_MS, PENDING_STORAGE_KEY, PendingTxStore, pendingKey } from "../pending";

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
  it("keys by route and parameters, in any order", () => {
    expect(pendingKey("a/b", { x: 1, y: "2" })).toBe(pendingKey("a/b", { y: "2", x: 1 }));
    expect(pendingKey("a/b", { x: 1 })).not.toBe(pendingKey("a/b", { x: 2 }));
    expect(pendingKey("a/b", { x: 1 })).not.toBe(pendingKey("a/c", { x: 1 }));
  });

  it("records before sending and refuses the same action while it's in flight, saved in storage", () => {
    const storage = memoryStorage();
    const store = new PendingTxStore({ api: createMockRocketpoolApi(), storage });
    expect(store.begin(input())).toBe(true);
    expect(JSON.parse(storage.data.get(PENDING_STORAGE_KEY)!)[0]).toMatchObject({ state: "sending", route: "node/distribute", page: "/rewards" });
    expect(store.begin(input())).toBe(false);
    expect(store.begin(input({ address: "0x2" }))).toBe(true); // a different action
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

  it("sees an action started in another tab", () => {
    const storage = memoryStorage();
    const tabA = new PendingTxStore({ api: createMockRocketpoolApi(), storage });
    const tabB = new PendingTxStore({ api: createMockRocketpoolApi(), storage });
    expect(tabA.begin(input())).toBe(true);
    expect(tabB.begin(input())).toBe(false);
  });
});
