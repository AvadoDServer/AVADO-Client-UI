import { useCallback, useEffect, useRef, useState } from "react";

/** Default intervals (spec §3). Service status and logs poll only while their view is open. */
export const POLL_MS = {
  nodeStatus: 12_000,
  validators: 60_000,
  service: 5_000,
  logs: 5_000,
} as const;

export interface UsePollOptions {
  /** false stops polling (the last data is kept). Default true. */
  enabled?: boolean;
  /** A new key clears the data and loads again at once (e.g. a pubkey or package name). */
  key?: string | number;
  /** Longest wait between polls while failing. Default max(4 × interval, 60 s). */
  maxBackoffMs?: number;
}

export interface PollResult<T> {
  /** The last successful answer; kept while later polls fail. */
  data: T | undefined;
  /** The last poll's error; cleared by the next success. */
  error: unknown;
  /** True until the first answer (success or error) for the current key. */
  loading: boolean;
  /**
   * Poll now (also while hidden) and restart the interval. If a poll is in
   * flight, poll again once it ends; resolves when that fresh poll is done.
   */
  refresh: () => Promise<void>;
}

/** Wait before the next poll after `failures` failures in a row: the interval, doubled per failure, capped. */
export function backoffDelay(intervalMs: number, failures: number, maxBackoffMs?: number): number {
  if (failures <= 0) return intervalMs;
  const cap = maxBackoffMs ?? Math.max(intervalMs * 4, 60_000);
  return Math.min(intervalMs * 2 ** Math.min(failures, 20), cap);
}

interface State<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
}

/**
 * Poll `fn` every `intervalMs`. Polls never overlap: the next one is
 * scheduled when the previous one ends. Polling pauses while the tab is
 * hidden and picks up when it is shown (at once if a poll is overdue). After
 * an error it waits longer each time (see `backoffDelay`) and goes back to
 * the normal interval after a success. The latest `fn` is always used, so an
 * inline arrow function is fine.
 */
export function usePoll<T>(fn: () => Promise<T>, intervalMs: number, options: UsePollOptions = {}): PollResult<T> {
  const { enabled = true, key, maxBackoffMs } = options;
  const [state, setState] = useState<State<T>>({ data: undefined, error: undefined, loading: enabled });

  const fnRef = useRef(fn);
  fnRef.current = fn;
  const runRef = useRef<(() => Promise<void>) | null>(null);
  const keyRef = useRef(key);

  useEffect(() => {
    const keyChanged = keyRef.current !== key;
    keyRef.current = key;
    if (keyChanged) setState({ data: undefined, error: undefined, loading: enabled });

    if (!enabled) {
      if (!keyChanged) setState((s) => (s.loading ? { ...s, loading: false } : s));
      return;
    }
    if (!keyChanged) setState((s) => (s.data === undefined && s.error === undefined && !s.loading ? { ...s, loading: true } : s));

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: Promise<void> | null = null;
    let failures = 0;
    let lastDoneAt = 0;
    let nextDelay = intervalMs;

    const clear = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const schedule = (delay: number) => {
      clear();
      if (cancelled || document.hidden) return;
      timer = setTimeout(() => {
        timer = undefined;
        void run();
      }, delay);
    };
    const run = (): Promise<void> => {
      if (inFlight) return inFlight;
      clear();
      inFlight = (async () => {
        try {
          const value = await fnRef.current();
          if (cancelled) return;
          failures = 0;
          setState({ data: value, error: undefined, loading: false });
        } catch (error) {
          if (cancelled) return;
          failures += 1;
          setState((s) => ({ ...s, error, loading: false }));
        } finally {
          inFlight = null;
          lastDoneAt = Date.now();
          if (!cancelled) {
            nextDelay = backoffDelay(intervalMs, failures, maxBackoffMs);
            schedule(nextDelay);
          }
        }
      })();
      return inFlight;
    };
    // refresh() usually follows a change (a key imported, a fee recipient
    // set). A poll already in flight may have read the old state, so after
    // it ends poll once more; concurrent refreshes share that one re-run.
    let rerun: Promise<void> | null = null;
    const refreshNow = (): Promise<void> => {
      if (!inFlight) return run();
      rerun ??= inFlight.then(() => {
        rerun = null;
        return cancelled ? undefined : run();
      });
      return rerun;
    };
    runRef.current = refreshNow;

    const onVisibility = () => {
      if (document.hidden) return clear();
      if (inFlight) return;
      const due = lastDoneAt + nextDelay - Date.now();
      if (due <= 0) void run();
      else schedule(due);
    };
    document.addEventListener("visibilitychange", onVisibility);

    // A tab opened in the background loads when it is first shown.
    if (!document.hidden) void run();

    return () => {
      cancelled = true;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
      if (runRef.current === refreshNow) runRef.current = null;
    };
  }, [enabled, key, intervalMs, maxBackoffMs]);

  const refresh = useCallback(() => runRef.current?.() ?? Promise.resolve(), []);

  return { ...state, refresh };
}
