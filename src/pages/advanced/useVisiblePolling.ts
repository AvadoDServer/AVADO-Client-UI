import { useEffect, useRef } from "react";

/**
 * Calls `callback` once immediately, then every `intervalMs`, for as long as
 * the owning component stays mounted and the tab stays visible: a tick is
 * skipped while `document.visibilityState === "hidden"`, and a fresh call
 * fires right away when the tab becomes visible again so the view doesn't
 * sit stale. Spec §3: "service status and logs: 5s, only while that view is
 * open."
 *
 * This is a small local stand-in for the shared `usePoll` hook Task 2 adds
 * in `src/hooks/usePoll.ts` in parallel; this page can move to that hook
 * once it lands.
 */
export function useVisiblePolling(callback: () => void | Promise<void>, intervalMs: number): void {
  // A ref keeps the effect below from tearing the interval down and
  // rebuilding it whenever the caller passes a new callback identity.
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void callbackRef.current();
    };

    tick();
    const timer = window.setInterval(tick, intervalMs);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs]);
}
