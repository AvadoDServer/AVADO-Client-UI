import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { usePoll } from "../../../hooks/usePoll";
import type { AvadoStatus, ReconcileView } from "../api/models";
import { useRocketpoolApi } from "../api/RocketpoolApiProvider";
import { findStatusProblems, type RpProblem } from "./problems";

/** How often the shell reads the package status and the key check (ms). */
export const STATUS_POLL_MS = 12_000;
export const RECONCILE_POLL_MS = 30_000;
/** Status polls that must fail in a row before the "not answering" banner shows. */
export const FAILURES_BEFORE_DOWN = 2;

export interface AppStatus {
  /** The last `/api/avado/status` answer (kept while later polls fail). */
  avado: AvadoStatus | undefined;
  /** The last status polls (at least two in a row) failed. */
  avadoFailed: boolean;
  /** Still waiting for the first status answer. */
  loading: boolean;
  reconcile: ReconcileView | undefined;
  /** The banners for every page. */
  problems: RpProblem[];
  /** Smartnode's API is up and has a token: `/api/sn/*` reads can work. */
  daemonReady: boolean;
  refresh: () => Promise<void>;
}

const AppStatusContext = createContext<AppStatus | null>(null);

/** Polls the package status and the key check once for the whole app. */
export function AppStatusProvider({ children }: { children: ReactNode }) {
  const api = useRocketpoolApi();
  // One failed poll is not enough to call the package down: count failures in a row.
  const failures = useRef(0);
  const status = usePoll(
    async () => {
      try {
        const s = await api.avadoStatus();
        failures.current = 0;
        return s;
      } catch (e) {
        failures.current += 1;
        throw e;
      }
    },
    STATUS_POLL_MS,
    { retryMs: 3_000 },
  );
  const reconcile = usePoll(() => api.reconcile(), RECONCILE_POLL_MS);

  const { data: avado, error: avadoError, loading, refresh: refreshStatus } = status;
  const { data: reconcileData, error: reconcileError, refresh: refreshReconcile } = reconcile;
  const avadoFailed = avadoError !== undefined && failures.current >= FAILURES_BEFORE_DOWN;
  const value = useMemo<AppStatus>(
    () => ({
      avado,
      avadoFailed,
      loading,
      reconcile: reconcileData,
      problems: findStatusProblems({ avado, avadoFailed, reconcile: reconcileError === undefined ? reconcileData : undefined }),
      daemonReady: !!avado && !avadoFailed && avado.daemon.state === "RUNNING" && avado.apiReachable && avado.apiTokenPresent,
      refresh: async () => {
        await Promise.all([refreshStatus(), refreshReconcile()]);
      },
    }),
    [avado, avadoFailed, loading, reconcileData, reconcileError, refreshStatus, refreshReconcile],
  );

  return <AppStatusContext.Provider value={value}>{children}</AppStatusContext.Provider>;
}

export function useAppStatus(): AppStatus {
  const v = useContext(AppStatusContext);
  if (!v) throw new Error("useAppStatus() must be used inside <AppStatusProvider>");
  return v;
}
