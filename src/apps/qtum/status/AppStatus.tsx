import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Problem } from "../../../components/shell/problems";
import { adminPackageUrl } from "../../../components/shell/links";
import { usePoll } from "../../../hooks/usePoll";
import { isUnreachable } from "../api/errors";
import { BUSY_STATES, type QtumSettings, type WalletStatus } from "../api/models";
import { readNodeInfo, type NodeInfo } from "../api/node";
import { useQtumApi } from "../api/QtumApiProvider";
import { describeNode, type NodeView } from "./nodeState";

export const QTUM_PACKAGE = "qtum.avado.dnp.dappnode.eth";

/** How often the shell reads things (ms). */
export const NODE_POLL_MS = 10_000;
export const WALLET_POLL_MS = 30_000;
/** While the wallet is being upgraded, rebuilt, restored or a key imported. */
export const WALLET_BUSY_POLL_MS = 5_000;
export const SETTINGS_POLL_MS = 30_000;
/** Polls that must fail in a row before the "not answering" banner shows. */
export const FAILURES_BEFORE_DOWN = 2;

export type QtumProblemId = "package-down";

export interface AppStatus {
  walletStatus: WalletStatus | undefined;
  walletStatusError: unknown;
  /** The last node read (kept while later reads fail). */
  node: NodeInfo | undefined;
  nodeError: unknown;
  settings: QtumSettings | undefined;
  /** Still waiting for the first wallet status. */
  loading: boolean;
  /** Neither the monitor nor the node answered, twice in a row. */
  packageDown: boolean;
  /** The monitor reports the wallet ready. */
  walletReady: boolean;
  /** No backup downloaded yet since the wallet was made. */
  backupRequired: boolean;
  nodeView: NodeView;
  problems: Problem<QtumProblemId>[];
  refreshWallet: () => Promise<void>;
  refreshNode: () => Promise<void>;
  refreshSettings: () => Promise<void>;
}

const AppStatusContext = createContext<AppStatus | null>(null);

const counted = <T,>(fn: () => Promise<T>, failures: { current: number }) => async () => {
  try {
    const v = await fn();
    failures.current = 0;
    return v;
  } catch (e) {
    failures.current = isUnreachable(e) ? failures.current + 1 : 0;
    throw e;
  }
};

/** Polls the wallet status, the node and the settings once for the whole app. */
export function AppStatusProvider({ children }: { children: ReactNode }) {
  const api = useQtumApi();
  const walletFailures = useRef(0);
  const nodeFailures = useRef(0);

  // Poll often while the wallet is busy (an upgrade, rebuild, restore or key import), else every 30 s.
  const [fast, setFast] = useState(false);
  const walletPoll = usePoll(counted(() => api.walletStatus(), walletFailures), fast ? WALLET_BUSY_POLL_MS : WALLET_POLL_MS, { retryMs: 3_000 });
  const walletStatus = walletPoll.data;
  const busy = !!walletStatus && (BUSY_STATES.includes(walletStatus.state) || walletStatus.import?.state === "running");
  useEffect(() => setFast(busy), [busy]);

  const nodePoll = usePoll(counted(() => readNodeInfo(api), nodeFailures), NODE_POLL_MS, { retryMs: 3_000 });
  const settingsPoll = usePoll(() => api.settings(), SETTINGS_POLL_MS);

  const packageDown = walletFailures.current >= FAILURES_BEFORE_DOWN && nodeFailures.current >= FAILURES_BEFORE_DOWN;
  const { refresh: refreshWallet } = walletPoll;
  const { data: node, error: nodeError, refresh: refreshNode } = nodePoll;
  const { data: settings, refresh: refreshSettings } = settingsPoll;
  const walletStatusError = walletPoll.error;
  const loading = walletPoll.loading;

  const value = useMemo<AppStatus>(() => {
    const problems: Problem<QtumProblemId>[] = packageDown
      ? [
          {
            id: "package-down",
            tone: "danger",
            title: "The Qtum package is not answering",
            body: "It may be restarting after an update: wait a minute. If it stays like this, restart the package in the AVADO Admin.",
            action: { label: "Open the package", href: adminPackageUrl(QTUM_PACKAGE) },
          },
        ]
      : [];
    return {
      walletStatus,
      walletStatusError,
      node,
      nodeError,
      settings,
      loading,
      packageDown,
      walletReady: walletStatus?.state === "ready",
      backupRequired: settings?.BACKUP_REQUIRED === true,
      nodeView: describeNode({ node, nodeError, walletStatus, packageDown }),
      problems,
      refreshWallet,
      refreshNode,
      refreshSettings,
    };
  }, [walletStatus, walletStatusError, node, nodeError, settings, loading, packageDown, refreshWallet, refreshNode, refreshSettings]);

  return <AppStatusContext.Provider value={value}>{children}</AppStatusContext.Provider>;
}

export function useAppStatus(): AppStatus {
  const v = useContext(AppStatusContext);
  if (!v) throw new Error("useAppStatus() must be used inside <AppStatusProvider>");
  return v;
}
