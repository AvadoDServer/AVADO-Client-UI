import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A small local polling hook for the shell (Task 3). Task 2 ships the shared
 * `usePoll` (error back-off and more); this file keeps the same
 * `{data, error, loading, refresh}` shape so the shell can switch to it with
 * a one-line change.
 *
 * - Runs `fn` now, then every `intervalMs` after each call settles.
 * - Skips ticks while the tab is hidden (the first read always runs, so a
 *   page opened in a background tab has data) and reads again as soon as
 *   the tab becomes visible.
 * - Keeps the last data when a call fails.
 * - Starts over when `resetKey` changes.
 */
export interface LocalPoll<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  refresh: () => void;
}

export function useLocalPoll<T>(fn: () => Promise<T>, intervalMs: number, resetKey: string | number = ""): LocalPoll<T> {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    let skipped = false;
    const hidden = () => typeof document !== "undefined" && document.hidden;
    const schedule = () => {
      if (!cancelled) timer = setTimeout(run, intervalMs);
    };
    async function run() {
      timer = undefined;
      if (!first && hidden()) {
        skipped = true;
        return schedule();
      }
      first = false;
      skipped = false;
      try {
        const data = await fnRef.current();
        if (!cancelled) setState({ data, loading: false });
      } catch (e) {
        if (!cancelled) setState((s) => ({ data: s.data, error: e instanceof Error ? e : new Error(String(e)), loading: false }));
      }
      schedule();
    }
    // Back in view after missing a tick: read now instead of waiting a full interval.
    const onVisible = () => {
      if (hidden() || !skipped || !timer) return;
      clearTimeout(timer);
      run();
    };
    run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs, resetKey, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { data: state.data, error: state.error, loading: state.loading, refresh };
}
