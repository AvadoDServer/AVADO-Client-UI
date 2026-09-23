/**
 * The real adapters for one client config (spec §3): package backend, beacon
 * and keymanager through `config.apiUrl`, DAPPMANAGER over WAMP. Nothing
 * connects until the first call.
 */
import type { ClientConfig } from "../config/clientConfig";
import { createPackageBackend } from "./backend";
import { createBeaconApi } from "./beacon";
import { createDappManager } from "./dappmanager";
import type { AdapterDeps } from "./http";
import { createKeymanagerApi } from "./keymanager";
import type { WebSocketCtor } from "./wamp";
import type { Api } from "./types";

export interface RealApiDeps extends AdapterDeps {
  WebSocket?: WebSocketCtor;
}

export type DisposableApi = Api & { dispose(): void };

export function createRealApi(config: ClientConfig, deps: RealApiDeps = {}): DisposableApi {
  const dappmanager = createDappManager({ WebSocket: deps.WebSocket });
  return {
    backend: createPackageBackend(config, deps),
    beacon: createBeaconApi(config, deps),
    keymanager: createKeymanagerApi(config, deps),
    dappmanager,
    /** Closes the WAMP session. */
    dispose: () => dappmanager.close(),
  };
}
