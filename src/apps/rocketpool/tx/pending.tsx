/**
 * The app's record of transactions that were sent (or may have been), so the
 * same action can never be sent twice while one is still on its way — no
 * matter if the dialog closed, the page changed or the browser reloaded.
 *
 * - An entry is written (and saved to localStorage) BEFORE the write request
 *   goes out, keyed by route + parameters. While it exists, `begin` refuses
 *   the same key anywhere in the app (and in other tabs, via the storage event).
 * - The request's outcome is always recorded, whoever is still listening.
 * - A sent transaction is followed with `/api/wait`: one wait per transaction,
 *   cancelled when superseded or when the app goes away, resumed on load.
 * - Entries end when the tx is mined (done) or failed; those two stay in
 *   memory only until acknowledged. An unclear send, or a wait that lost
 *   track, can be dismissed by the owner only after `DISMISS_AFTER_MS`.
 */
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { isRpApiError, isTxReverted, plainError } from "../api/errors";
import { useRocketpoolApi } from "../api/RocketpoolApiProvider";
import { waitForTx } from "../api/sn";
import type { RocketpoolApi, SnParams } from "../api/types";
import { isTxHash } from "../lib/explorer";

export const PENDING_STORAGE_KEY = "avado-rocketpool.pending-tx.v1";
/** An unclear send or a lost wait can be dismissed after this long. */
export const DISMISS_AFTER_MS = 10 * 60_000;

/**
 * - `sending`: the write request is on its way (or the page closed during it).
 * - `sent`: the node returned a tx hash; waiting for it to be mined.
 * - `unknown`: no clear answer to the write; it may or may not have been sent.
 * - `lost`: sent, but the wait ended without an answer (still pending, maybe dropped).
 * - `done` / `failed`: mined, and it went through / reverted (in memory only).
 */
export type PendingState = "sending" | "sent" | "unknown" | "lost" | "done" | "failed";

export interface PendingTx {
  key: string;
  /** What it was, in the owner's words (the dialog title). */
  title: string;
  route: string;
  params: SnParams;
  /** The app page it was started from (for the banner link). */
  page: string;
  state: PendingState;
  txHash?: string;
  /** Plain-language detail for unknown / lost / failed. */
  message?: string;
  createdAt: number;
  updatedAt: number;
}

const PERSISTED: ReadonlySet<PendingState> = new Set(["sending", "sent", "unknown", "lost"]);
/** States that block starting the same action again. */
const BLOCKING: ReadonlySet<PendingState> = new Set(["sending", "sent", "unknown", "lost"]);

/** The store key of an action: its route and its parameters, order-independent. */
export function pendingKey(route: string, params: SnParams = {}): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => [k, String(params[k])]);
  return `${route}?${JSON.stringify(sorted)}`;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readEntry(v: unknown): PendingTx | null {
  if (!isObject(v)) return null;
  const { key, title, route, params, page, state, txHash, message, createdAt, updatedAt } = v;
  if (typeof key !== "string" || typeof route !== "string" || !isObject(params)) return null;
  if (typeof state !== "string" || !PERSISTED.has(state as PendingState)) return null;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  const flat: SnParams = {};
  for (const [k, p] of Object.entries(params)) {
    if (typeof p === "string" || typeof p === "number" || typeof p === "boolean") flat[k] = p;
  }
  const entry: PendingTx = {
    key,
    title: typeof title === "string" ? title : route,
    route,
    params: flat,
    page: typeof page === "string" && page.startsWith("/") ? page : "/",
    state: state as PendingState,
    createdAt,
    updatedAt: typeof updatedAt === "number" ? updatedAt : createdAt,
  };
  if (isTxHash(txHash)) entry.txHash = txHash;
  if (typeof message === "string") entry.message = message;
  // A "sent" entry without a hash can't be followed: its outcome is unknown.
  if (entry.state === "sent" && !entry.txHash) entry.state = "unknown";
  return entry;
}

export interface PendingStoreOptions {
  api: RocketpoolApi;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  now?: () => number;
}

export class PendingTxStore {
  private entries = new Map<string, PendingTx>();
  private listeners = new Set<() => void>();
  private waiters = new Map<string, AbortController>();
  private doneCallbacks = new Map<string, Set<(hash: string) => void>>();
  private version = 0;
  private started = false;
  private readonly api: RocketpoolApi;
  private readonly storage: PendingStoreOptions["storage"];
  private readonly now: () => number;

  constructor({ api, storage, now = Date.now }: PendingStoreOptions) {
    this.api = api;
    this.storage = storage === undefined ? safeLocalStorage() : storage;
    this.now = now;
    this.load(false);
  }

  /* ----- reading ----- */

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  get(key: string): PendingTx | undefined {
    return this.entries.get(key);
  }

  list(): PendingTx[] {
    return [...this.entries.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  /** True while the action is in flight or its outcome is unclear: it must not be started again. */
  isBlocking(key: string): boolean {
    const e = this.entries.get(key);
    return !!e && BLOCKING.has(e.state);
  }

  /** Done / failed can be acknowledged at once; unknown / lost only after `DISMISS_AFTER_MS`. */
  canDismiss(key: string): boolean {
    const e = this.entries.get(key);
    if (!e) return false;
    if (e.state === "done" || e.state === "failed") return true;
    return (e.state === "unknown" || e.state === "lost") && this.now() - e.createdAt >= DISMISS_AFTER_MS;
  }

  /* ----- lifecycle ----- */

  /** Resume following every sent tx (on app load); listen to other tabs. */
  start(): void {
    if (this.started) return;
    this.started = true;
    for (const e of this.entries.values()) if (e.state === "sent" || e.state === "lost") this.follow(e.key);
    if (typeof window !== "undefined") window.addEventListener("storage", this.onStorage);
  }

  /** Cancel every wait (the app is going away). Entries stay saved. */
  stop(): void {
    this.started = false;
    for (const c of this.waiters.values()) c.abort();
    this.waiters.clear();
    if (typeof window !== "undefined") window.removeEventListener("storage", this.onStorage);
  }

  /* ----- writing ----- */

  /**
   * Record an action BEFORE its write request is sent. False (and nothing
   * changes) when the same action is already in flight or unclear.
   */
  begin(input: { key: string; title: string; route: string; params: SnParams; page?: string }): boolean {
    this.load(true); // another tab may have started it
    if (this.isBlocking(input.key)) return false;
    const t = this.now();
    this.put({ ...input, page: input.page ?? "/", params: { ...input.params }, state: "sending", createdAt: t, updatedAt: t });
    return true;
  }

  /** The node returned a tx hash: follow it. `onDone` runs when it is mined and went through, even if the dialog is gone. */
  markSent(key: string, txHash: string, onDone?: (hash: string) => void): void {
    const e = this.entries.get(key);
    if (!e) return;
    if (onDone) this.onDone(key, onDone);
    this.put({ ...e, state: "sent", txHash, message: undefined, updatedAt: this.now() });
    this.follow(key);
  }

  /** No clear answer to the write request. */
  markUnknown(key: string, message: string): void {
    const e = this.entries.get(key);
    if (e) this.put({ ...e, state: "unknown", message, updatedAt: this.now() });
  }

  /** The write was refused: nothing to track. */
  markNotSent(key: string): void {
    this.remove(key);
  }

  /** Register a callback for when the key's tx is mined and went through. */
  onDone(key: string, fn: (hash: string) => void): void {
    const set = this.doneCallbacks.get(key) ?? new Set();
    set.add(fn);
    this.doneCallbacks.set(key, set);
  }

  /**
   * Follow the key's tx until mined. One wait per tx: a call while one runs
   * does nothing, unless `restart` (then the old wait is cancelled first).
   */
  follow(key: string, { restart = false } = {}): void {
    const e = this.entries.get(key);
    if (!e || !e.txHash || (e.state !== "sent" && e.state !== "lost")) return;
    const running = this.waiters.get(key);
    if (running && !restart) return;
    running?.abort();
    const controller = new AbortController();
    this.waiters.set(key, controller);
    if (e.state === "lost") this.put({ ...e, state: "sent", message: undefined, updatedAt: this.now() });
    const hash = e.txHash;
    waitForTx(this.api, hash, { signal: controller.signal }).then(
      () => this.settle(key, controller, hash, "done"),
      (err: unknown) => {
        if (controller.signal.aborted || (isRpApiError(err) && err.kind === "aborted")) return;
        if (isTxReverted(err)) this.settle(key, controller, hash, "failed", "It was included in a block but did not go through.");
        else this.settle(key, controller, hash, "lost", plainError(err));
      },
    );
  }

  /** Forget an entry the owner has seen (done / failed), or gave up on after the age limit. */
  dismiss(key: string): boolean {
    if (!this.canDismiss(key)) return false;
    this.waiters.get(key)?.abort();
    this.waiters.delete(key);
    this.remove(key);
    return true;
  }

  /* ----- internals ----- */

  private settle(key: string, controller: AbortController, hash: string, state: PendingState, message?: string) {
    if (this.waiters.get(key) !== controller) return; // superseded
    this.waiters.delete(key);
    const e = this.entries.get(key);
    if (!e || e.txHash !== hash) return;
    this.put({ ...e, state, message, updatedAt: this.now() });
    if (state === "done") {
      const callbacks = this.doneCallbacks.get(key);
      this.doneCallbacks.delete(key);
      callbacks?.forEach((fn) => {
        try {
          fn(hash);
        } catch {
          /* a page's refresh must not break the store */
        }
      });
    } else if (state === "failed") {
      this.doneCallbacks.delete(key);
    }
  }

  private put(e: PendingTx) {
    this.entries.set(e.key, e);
    this.save();
    this.emit();
  }

  private remove(key: string) {
    if (!this.entries.delete(key)) return;
    this.doneCallbacks.delete(key);
    this.save();
    this.emit();
  }

  private emit() {
    this.version += 1;
    this.listeners.forEach((fn) => fn());
  }

  private save() {
    if (!this.storage) return;
    try {
      const persisted = [...this.entries.values()].filter((e) => PERSISTED.has(e.state));
      if (persisted.length === 0) this.storage.removeItem(PENDING_STORAGE_KEY);
      else this.storage.setItem(PENDING_STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      /* storage full or blocked: the in-memory guard still holds for this page */
    }
  }

  /**
   * Read saved entries. On first load a leftover `sending` becomes `unknown`
   * (the page closed while it was being sent). `merge` adds entries saved
   * by another tab without touching the ones this tab already tracks.
   */
  private load(merge: boolean) {
    if (!this.storage) return;
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(PENDING_STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let list: unknown;
    try {
      list = JSON.parse(raw);
    } catch {
      return;
    }
    let changed = false;
    for (const item of Array.isArray(list) ? list : []) {
      const e = readEntry(item);
      if (!e || (merge && this.entries.has(e.key))) continue;
      if (!merge && e.state === "sending") {
        e.state = "unknown";
        e.message = "The page was closed or reloaded while this was being sent.";
      }
      this.entries.set(e.key, e);
      changed = true;
      if (merge && this.started && (e.state === "sent" || e.state === "lost")) this.follow(e.key);
    }
    if (changed) {
      if (!merge) this.save();
      this.emit();
    }
  }

  private onStorage = (ev: StorageEvent) => {
    if (ev.key === PENDING_STORAGE_KEY) this.load(true);
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

const PendingContext = createContext<PendingTxStore | null>(null);

/** One store for the whole app; resumes waits on load and cancels them on unmount. */
export function PendingTxProvider({ children, store }: { children: ReactNode; /** Tests. */ store?: PendingTxStore }) {
  const api = useRocketpoolApi();
  const value = useMemo(() => store ?? new PendingTxStore({ api }), [store, api]);
  useEffect(() => {
    value.start();
    return () => value.stop();
  }, [value]);
  return <PendingContext.Provider value={value}>{children}</PendingContext.Provider>;
}

/** The store, re-rendering the caller whenever it changes. */
export function usePendingTxs(): PendingTxStore {
  const store = useContext(PendingContext);
  if (!store) throw new Error("usePendingTxs() must be used inside <PendingTxProvider>");
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}
