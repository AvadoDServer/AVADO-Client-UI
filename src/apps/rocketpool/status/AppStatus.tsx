import { createContext, useContext, useMemo, type ReactNode } from "react";
import { usePoll } from "../../../hooks/usePoll";
import type { AvadoStatus, ReconcileView } from "../api/models";
import { useRocketpoolApi } from "../api/RocketpoolApiProvider";
import { findStatusProblems, type RpProblem } from "./problems";

/** How often the shell reads the package status and the key check (ms). */
export const STATUS_POLL_MS = 12_000;
export const RECONCILE_POLL_MS = 30_000;

export interface AppStatus {
  /** The last `/api/avado/status` answer (kept while later polls fail). */
  avado: AvadoStatus | undefined;
  /** The last status poll failed. */
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
  const status = usePoll(() => api.avadoStatus(), STATUS_POLL_MS, { retryMs: 3_000 });
  const reconcile = usePoll(() => api.reconcile(), RECONCILE_POLL_MS);

  const { data: avado, error: avadoError, loading, refresh: refreshStatus } = status;
  const { data: reconcileData, error: reconcileError, refresh: refreshReconcile } = reconcile;
  const avadoFailed = avadoError !== undefined;
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
