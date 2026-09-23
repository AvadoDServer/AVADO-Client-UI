/**
 * Standard beacon-node REST API (eth/v1) through the package backend's
 * `${apiUrl}/rest` proxy. Same paths for every client; the proxies forward
 * the path only, so nothing here uses a query string.
 */
import type { ClientConfig } from "../config/clientConfig";
import { ApiError } from "./errors";
import { createHttp, getData, unwrapData, type AdapterDeps } from "./http";
import type { BeaconApi, NodeHealth, Peer, PeerCount, SyncingStatus, ValidatorState } from "./types";

/** "Nimbus/v26.8.0-1a2b3c-stateofus" → "v26.8.0"; anything else is returned as is. */
export function shortVersion(full: string): string {
  return full.match(/v\d+\.\d+\.\d+/)?.[0] ?? full;
}

export function createBeaconApi(config: Pick<ClientConfig, "apiUrl">, deps: AdapterDeps = {}): BeaconApi {
  const http = createHttp({ baseUrl: `${config.apiUrl.replace(/\/+$/, "")}/rest`, service: "beacon", fetch: deps.fetch, proxied: true });

  return {
    async health(): Promise<NodeHealth> {
      // 200 ready, 206 syncing, anything else (503, or a 500 from the proxy
      // while the client is down) not ready. No answer at all still throws.
      const { status } = await http.request("/eth/v1/node/health", { accept: () => true });
      if (status === 200) return "ready";
      if (status === 206) return "syncing";
      return "not_ready";
    },

    syncing: () => getData<SyncingStatus>(http, "beacon", "/eth/v1/node/syncing"),

    peerCount: () => getData<PeerCount>(http, "beacon", "/eth/v1/node/peer_count"),

    async peers() {
      const path = "/eth/v1/node/peers";
      const peers = await getData<Peer[]>(http, "beacon", path);
      if (!Array.isArray(peers)) throw new ApiError({ kind: "invalid", service: "beacon", path, detail: "peers is not an array" });
      return peers;
    },

    async version() {
      const data = await getData<{ version?: unknown }>(http, "beacon", "/eth/v1/node/version");
      if (typeof data?.version !== "string") {
        throw new ApiError({ kind: "invalid", service: "beacon", path: "/eth/v1/node/version", detail: "no version string" });
      }
      return shortVersion(data.version);
    },

    async validator(pubkey) {
      const path = `/eth/v1/beacon/states/head/validators/${encodeURIComponent(pubkey)}`;
      const { status, data } = await http.request(path, { accept: (s) => s === 404 });
      if (status === 404) return null;
      return unwrapData<ValidatorState>(data, "beacon", path, status);
    },

    async submitVoluntaryExit(msg) {
      await http.request("/eth/v1/beacon/pool/voluntary_exits", { method: "POST", body: msg });
    },
  };
}
