/**
 * DAPPMANAGER over WAMP (spec §2.6): only `listPackages` and `logPackage`.
 * Each procedure returns a JSON *string* holding `{success, message, result}`;
 * the old wizards `JSON.parse`d it and used `result` only when
 * `success === true`, and so do we.
 *
 * Callers must never read a failed listPackages as "not installed": while the
 * DAPPMANAGER restarts the router answers `no_such_procedure`, which surfaces
 * as an `unreachable` ApiError (see wamp.ts).
 */
import { ApiError } from "./errors";
import { WampClient, type WampOptions } from "./wamp";
import type { DappManager, PackageState } from "./types";

export const WAMP_URL = "ws://wamp.my.ava.do:8080/ws";
export const WAMP_REALM = "dappnode_admin";

const LIST_PACKAGES = "listPackages.dappmanager.dnp.dappnode.eth";
const LOG_PACKAGE = "logPackage.dappmanager.dnp.dappnode.eth";

/** What the adapter needs from a WAMP session (WampClient, or a fake in tests). */
export interface WampCaller {
  call(procedure: string, args?: unknown[], kwargs?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
}

export function unwrapEnvelope(raw: unknown, procedure: string): unknown {
  let env: unknown = raw;
  if (typeof raw === "string") {
    try {
      env = JSON.parse(raw);
    } catch {
      throw new ApiError({ kind: "invalid", service: "dappmanager", path: procedure, detail: "reply is not JSON" });
    }
  }
  if (typeof env !== "object" || env === null) {
    throw new ApiError({ kind: "invalid", service: "dappmanager", path: procedure, detail: "reply is not an object" });
  }
  const { success, message, result } = env as { success?: unknown; message?: unknown; result?: unknown };
  if (success !== true) {
    throw new ApiError({
      kind: "rejected",
      service: "dappmanager",
      path: procedure,
      detail: typeof message === "string" ? message : undefined,
    });
  }
  return result;
}

export interface DappManagerOptions {
  /** A session to use (tests). By default a WampClient to WAMP_URL / WAMP_REALM. */
  wamp?: WampCaller;
  WebSocket?: WampOptions["WebSocket"];
}

export function createDappManager(opts: DappManagerOptions = {}): DappManager & { close(): void } {
  const wamp = opts.wamp ?? new WampClient({ url: WAMP_URL, realm: WAMP_REALM, WebSocket: opts.WebSocket });

  const listPackageStates = async (): Promise<PackageState[]> => {
    // listPackages runs `docker system df`, which can be slow on a busy box.
    const result = unwrapEnvelope(await wamp.call(LIST_PACKAGES, undefined, undefined, 60_000), LIST_PACKAGES);
    if (!Array.isArray(result)) {
      throw new ApiError({ kind: "invalid", service: "dappmanager", path: LIST_PACKAGES, detail: "result is not a list" });
    }
    // The DAPPMANAGER lists containers (stopped ones too, `running: false`);
    // a package with several containers counts as running if any runs.
    const byName = new Map<string, boolean>();
    for (const p of result as Array<{ name?: unknown; running?: unknown }>) {
      if (typeof p?.name !== "string") continue;
      byName.set(p.name, (byName.get(p.name) ?? false) || Boolean(p.running));
    }
    return [...byName].map(([name, running]) => ({ name, running }));
  };

  return {
    /** Every installed package, running or stopped. An error means "unknown", never "not installed". */
    async listPackages() {
      return (await listPackageStates()).map((p) => p.name);
    },

    listPackageStates,

    async logs(pkg, tail) {
      const result = unwrapEnvelope(await wamp.call(LOG_PACKAGE, [], { id: pkg, options: { tail } }), LOG_PACKAGE);
      return typeof result === "string" ? result : "";
    },

    close() {
      if (wamp instanceof WampClient) wamp.close();
    },
  };
}
