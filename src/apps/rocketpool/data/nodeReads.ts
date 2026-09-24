/**
 * The Smartnode reads Home and Setup show, polled while their page is open.
 * They only run once the daemon answers and a wallet exists: before that,
 * Smartnode answers every node read with "wallet not initialized".
 */
import { usePoll } from "../../../hooks/usePoll";
import type { MegapoolStatusResponse, NodeStatus, NodeSync, RewardsInfo, SmoothingPoolStatus } from "../api/models";
import { useRocketpoolApi } from "../api/RocketpoolApiProvider";
import { getMegapoolStatus, getNodeStatus, getNodeSync, getRewardsInfo, getSmoothingPoolStatus } from "../api/sn";
import { useAppStatus } from "../status/AppStatus";

export const NODE_POLL_MS = 30_000;
export const SLOW_POLL_MS = 120_000;

/** Smartnode can answer node reads: the daemon is ready and there is a wallet. */
export function useNodeReadable(): boolean {
  const { daemonReady, avado } = useAppStatus();
  return daemonReady && !!avado?.walletFilePresent;
}

export function useNodeStatus(enabled: boolean) {
  const api = useRocketpoolApi();
  return usePoll<NodeStatus>(() => getNodeStatus(api), NODE_POLL_MS, { enabled });
}

export function useNodeSync(enabled: boolean) {
  const api = useRocketpoolApi();
  return usePoll<NodeSync>(() => getNodeSync(api), NODE_POLL_MS, { enabled });
}

export function useMegapoolStatus(enabled: boolean) {
  const api = useRocketpoolApi();
  return usePoll<MegapoolStatusResponse>(() => getMegapoolStatus(api), NODE_POLL_MS, { enabled });
}

export function useRewardsInfo(enabled: boolean) {
  const api = useRocketpoolApi();
  return usePoll<RewardsInfo>(() => getRewardsInfo(api), SLOW_POLL_MS, { enabled });
}

export function useSmoothingPoolStatus(enabled: boolean) {
  const api = useRocketpoolApi();
  return usePoll<SmoothingPoolStatus>(() => getSmoothingPoolStatus(api), NODE_POLL_MS, { enabled });
}
