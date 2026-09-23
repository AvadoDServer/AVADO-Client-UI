/**
 * The app's record of transactions that were sent (or may have been), so the
 * same action can never be sent twice while one is still on its way — no
 * matter if the dialog closed, the page changed or the browser reloaded.
 *
 * - An entry is written (and saved to localStorage) BEFORE the write request
 *   goes out, keyed by the route and only the parameters that name a separate
 *   target (a minipool address, a validator id, pubkey or index): amounts,
 *   salts and fees are never part of the key, so a changed amount or a fresh
 *   deposit salt can't get a second send past it. While the entry exists,
 *   `begin` refuses the same key anywhere in the app (and in other tabs).
 * - The request's outcome is always recorded, whoever is still listening.
 * - A sent transaction is followed with `/api/wait`: one wait per transaction,
 *   cancelled when superseded or when the app goes away, resumed on load.
 * - Entries end when the tx is mined (done) or failed; those two stay in
 *   memory only until acknowledged. An unclear send, or a wait that lost
 *   track, can be dismissed by the owner only after `DISMISS_AFTER_MS`. Ages
 *   are measured by the wall clock and by time seen in this page, whichever is
 *   longer, so a clock set back (or a bad timestamp) never locks an action for good.
 * - A tx not mined for `OVERDUE_AFTER_MS` is "overdue": it isn't waited on again
 *   automatically on every load; the owner chooses to keep waiting or to stop
 *   tracking it (after checking the explorer).
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
/** A sent tx not mined after this long is overdue (the backend's wait also gives up after an hour). */
export const OVERDUE_AFTER_MS = 60 * 60_000;

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
  /** Wall-clock time the current wait started (sent, or "keep waiting"). */
  waitingSince?: number;
}

const PERSISTED: ReadonlySet<PendingState> = new Set(["sending", "sent", "unknown", "lost"]);
/** States that block starting the same action again. */
const BLOCKING: ReadonlySet<PendingState> = new Set(["sending", "sent", "unknown", "lost"]);

/**
 * Parameters that name a separate target of the same route (one minipool,
 * one megapool validator): actions on different targets don't block each
 * other. Nothing else (amounts, salts, counts, fees) is ever part of the key.
 */
export function lockParams(route: string): readonly string[] {
  if (route.startsWith("minipool/")) return ["address"];
  if (route.startsWith("megapool/")) return ["validatorId", "validatorIndex", "pubkey"];
  return [];
}

/** The lock key of an action: its route, plus its target parameters if it has any. */
export function pendingKey(route: string, params: SnParams = {}): string {
  const targets = lockParams(route)
    .filter((k) => params[k] !== undefined && String(params[k]) !== "")
    .map((k) => [k, String(params[k]).toLowerCase()]);
  return targets.length ? `${route}?${JSON.stringify(targets)}` : route;
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
  if (typeof v.waitingSince === "number" && Number.isFinite(v.waitingSince)) entry.waitingSince = v.waitingSince;
  if (typeof message === "string") entry.message = message;
  // A "sent" entry without a hash can't be followed: its outcome is unknown.
  if (entry.state === "sent" && !entry.txHash) entry.state = "unknown";
  return entry;
}

export interface PendingStoreOptions {
  api: RocketpoolApi;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  /** Wall clock (ms). */
  now?: () => number;
  /** A clock that only moves forward within this page (ms); `performance.now` by default. */
  monotonic?: () => number;
}

const defaultMonotonic = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

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
  private readonly mono: () => number;
  /** Per key: the monotonic time this page first saw it / its current wait started. */
  private seenAt = new Map<string, number>();
  private waitSeenAt = new Map<string, number>();
  /** Keys this page last saw in storage (so a removal by another tab can be told apart). */
  private inStorage = new Set<string>();

  constructor({ api, storage, now = Date.now, monotonic = defaultMonotonic }: PendingStoreOptions) {
    this.api = api;
    this.storage = storage === undefined ? safeLocalStorage() : storage;
    this.now = now;
    this.mono = monotonic;
    this.load();
  }

  /** How long ago `wallSince` was: the wall clock or the time seen in this page, whichever is longer. */
  private age(wallSince: number, seenMono: number | undefined): number {
    const wall = this.now() - wallSince;
    const session = seenMono === undefined ? 0 : this.mono() - seenMono;
    return Math.max(wall, session);
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

  /**
   * A sent tx that hasn't been mined for an hour and isn't being waited on
   * right now: the owner decides to keep waiting or to stop tracking it.
   */
  isOverdue(key: string): boolean {
    const e = this.entries.get(key);
    if (!e || (e.state !== "sent" && e.state !== "lost") || this.waiters.has(key)) return false;
    return this.age(e.waitingSince ?? e.updatedAt, this.waitSeenAt.get(key) ?? this.seenAt.get(key)) >= OVERDUE_AFTER_MS;
  }

  /**
   * Done / failed can be acknowledged at once; unknown / lost after
   * `DISMISS_AFTER_MS`; an overdue tx at once (after the owner's warning).
   */
  canDismiss(key: string): boolean {
    const e = this.entries.get(key);
    if (!e) return false;
    if (e.state === "done" || e.state === "failed") return true;
    if (this.isOverdue(key)) return true;
    return (e.state === "unknown" || e.state === "lost") && this.age(e.createdAt, this.seenAt.get(key)) >= DISMISS_AFTER_MS;
  }

  /* ----- lifecycle ----- */

  /** Resume following every sent tx (on app load); listen to other tabs. */
  start(): void {
    if (this.started) return;
    this.started = true;
    // An overdue tx is not waited on again by itself: the owner chooses.
    for (const e of this.entries.values()) if ((e.state === "sent" || e.state === "lost") && !this.isOverdue(e.key)) this.follow(e.key);
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
    this.syncFromStorage(); // another tab may have started it
    if (this.isBlocking(input.key)) return false;
    const t = this.now();
    this.seenAt.set(input.key, this.mono());
    this.waitSeenAt.delete(input.key);
    this.put({ ...input, page: input.page ?? "/", params: { ...input.params }, state: "sending", createdAt: t, updatedAt: t });
    return true;
  }

  /** The node returned a tx hash: follow it. `onDone` runs when it is mined and went through, even if the dialog is gone. */
  markSent(key: string, txHash: string, onDone?: (hash: string) => void): void {
    const e = this.entries.get(key);
    if (!e) return;
    if (onDone) this.onDone(key, onDone);
    const t = this.now();
    this.waitSeenAt.set(key, this.mono());
    this.put({ ...e, state: "sent", txHash, message: undefined, updatedAt: t, waitingSince: t });
    this.follow(key);
  }

  /**
   * No clear answer to the write request. Storage is read first: if another
   * tab already has a newer record for it (it got the hash, or saw it mined
   * and removed it), that wins over "unknown".
   */
  markUnknown(key: string, message: string): void {
    this.syncFromStorage();
    const e = this.entries.get(key);
    if (!e || e.state !== "sending") return;
    this.put({ ...e, state: "unknown", message, updatedAt: this.now() });
  }

  /** The owner chose to keep waiting on an overdue tx: one more wait, and a fresh hour. */
  keepWaiting(key: string): void {
    const e = this.entries.get(key);
    if (!e || !e.txHash || (e.state !== "sent" && e.state !== "lost")) return;
    this.waitSeenAt.set(key, this.mono());
    this.put({ ...e, state: "sent", message: undefined, waitingSince: this.now(), updatedAt: this.now() });
    this.follow(key, { restart: true });
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
    this.removedHere.delete(e.key);
    this.entries.set(e.key, e);
    this.save();
    this.emit();
  }

  private remove(key: string) {
    if (!this.entries.delete(key)) return;
    this.doneCallbacks.delete(key);
    this.removedHere.add(key);
    this.save();
    this.emit();
  }

  /** Keys this page removed and hasn't saved yet (so a merge doesn't bring them back). */
  private removedHere = new Set<string>();

  private emit() {
    this.version += 1;
    this.listeners.forEach((fn) => fn());
  }

  /** Save after merging what other tabs wrote since, so nothing newer of theirs is overwritten. */
  private save() {
    if (!this.storage) return;
    this.syncFromStorage(false);
    try {
      const persisted = [...this.entries.values()].filter((e) => PERSISTED.has(e.state));
      if (persisted.length === 0) this.storage.removeItem(PENDING_STORAGE_KEY);
      else this.storage.setItem(PENDING_STORAGE_KEY, JSON.stringify(persisted));
      this.inStorage = new Set(persisted.map((e) => e.key));
      this.removedHere.clear();
    } catch {
      /* storage full or blocked: the in-memory guard still holds for this page */
    }
  }

  /** Saved entries by key; null when storage can't be read. */
  private readStorage(): Map<string, PendingTx> | null {
    if (!this.storage) return null;
    let raw: string | null;
    try {
      raw = this.storage.getItem(PENDING_STORAGE_KEY);
    } catch {
      return null;
    }
    const out = new Map<string, PendingTx>();
    if (!raw) return out;
    let list: unknown;
    try {
      list = JSON.parse(raw);
    } catch {
      return out;
    }
    for (const item of Array.isArray(list) ? list : []) {
      const e = readEntry(item);
      if (e) out.set(e.key, e);
    }
    return out;
  }

  /**
   * First load. A leftover `sending` is shown as `unknown` (the page closed
   * while it was being sent) — in memory only, so a tab that is still sending
   * it isn't overruled.
   */
  private load() {
    const saved = this.readStorage();
    if (!saved) return;
    for (const e of saved.values()) {
      const shown = e.state === "sending" ? { ...e, state: "unknown" as const, message: "The page was closed or reloaded while this was being sent." } : e;
      this.entries.set(e.key, shown);
      this.seenAt.set(e.key, this.mono());
    }
    this.inStorage = new Set(saved.keys());
    if (saved.size) this.emit();
  }

  /**
   * Take in what other tabs saved: new entries are added, newer versions of
   * known ones win, and an entry another tab removed (mined, failed or
   * dismissed there) is dropped here too.
   */
  private syncFromStorage(notify = true) {
    const saved = this.readStorage();
    if (!saved) return;
    let changed = false;
    for (const [key, e] of this.entries) {
      if (!PERSISTED.has(e.state)) continue;
      if (!saved.has(key) && this.inStorage.has(key)) {
        this.entries.delete(key);
        this.waiters.get(key)?.abort();
        this.waiters.delete(key);
        changed = true;
      }
    }
    for (const [key, e] of saved) {
      if (this.removedHere.has(key)) continue;
      const mine = this.entries.get(key);
      if (!mine) {
        this.entries.set(key, e);
        this.seenAt.set(key, this.mono());
        changed = true;
        if (this.started && (e.state === "sent" || e.state === "lost") && !this.isOverdue(key)) queueMicrotask(() => this.follow(key));
      } else if (e.updatedAt > mine.updatedAt && PERSISTED.has(mine.state)) {
        this.entries.set(key, e);
        changed = true;
        if (this.started && e.state === "sent" && !this.waiters.has(key)) queueMicrotask(() => this.follow(key));
      }
    }
    this.inStorage = new Set(saved.keys());
    if (changed && notify) this.emit();
  }

  private onStorage = (ev: StorageEvent) => {
    if (ev.key === PENDING_STORAGE_KEY) this.syncFromStorage();
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
