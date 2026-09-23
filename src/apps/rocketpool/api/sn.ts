/**
 * Typed shortcuts over `RocketpoolApi.snGet/snPost` for the routes every
 * screen uses. Routes and fields: research §3.3.
 */
import { isTxHash } from "../lib/explorer";
import type {
  GasPriceResponse,
  MegapoolStatusResponse,
  MinipoolStatusResponse,
  NodeStatus,
  NodeSync,
  RewardsInfo,
  SmoothingPoolStatus,
  SnEnvelope,
  VersionResponse,
  WalletExport,
  WalletStatus,
} from "./models";
import type { RocketpoolApi } from "./types";

export const getVersion = (api: RocketpoolApi) => api.snGet<VersionResponse>("version");
export const getWalletStatus = (api: RocketpoolApi) => api.snGet<WalletStatus>("wallet/status");
export const getNodeStatus = (api: RocketpoolApi) => api.snGet<NodeStatus>("node/status");
export const getNodeSync = (api: RocketpoolApi) => api.snGet<NodeSync>("node/sync");
export const getMinipoolStatus = (api: RocketpoolApi) => api.snGet<MinipoolStatusResponse>("minipool/status");
export const getMegapoolStatus = (api: RocketpoolApi) => api.snGet<MegapoolStatusResponse>("megapool/status", { finalizedState: false });
export const getRewardsInfo = (api: RocketpoolApi) => api.snGet<RewardsInfo>("node/get-rewards-info");
export const getSmoothingPoolStatus = (api: RocketpoolApi) =>
  api.snGet<SmoothingPoolStatus>("node/get-smoothing-pool-registration-status");
/** The latest block's base fee (wei). */
export const getGasPrice = (api: RocketpoolApi) => api.snGet<GasPriceResponse>("service/get-gas-price-from-latest-block");

/**
 * Blocks until the transaction is mined. Resolves when it succeeded; throws
 * a `smartnode` error when it was mined but failed ("status 0").
 */
export function waitForTx(api: RocketpoolApi, txHash: string): Promise<SnEnvelope> {
  if (!isTxHash(txHash)) return Promise.reject(new TypeError("Not a transaction hash"));
  return api.snGet<SnEnvelope>("wait", { txHash });
}

/** The exact text the owner must type before the wallet is exported (backend guard). */
export const EXPORT_CONFIRMATION = "EXPORT";

/**
 * The wallet backup: password, wallet file and account key. The backend
 * refuses unless `typed` is exactly "EXPORT". The result is secret: show it
 * or hand it to a download, never store or log it.
 */
export const exportWallet = (api: RocketpoolApi, typed: string) =>
  api.snPost<WalletExport>("wallet/export", { typedConfirmation: typed });
