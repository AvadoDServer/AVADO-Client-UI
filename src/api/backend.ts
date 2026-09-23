/**
 * The package backend on :9999: `/settings`, `/defaultsettings` and the
 * supervisord `/service/*` routes (spec §2.3).
 *
 * deno (Nimbus, Lighthouse) and monitor (Teku, Prysm) serve the same routes;
 * their answers differ in shape and are normalised here:
 *  - monitor `GET /settings` double-encodes: the body is a JSON *string* that
 *    holds the settings JSON (`res.send(200, JSON.stringify(settings))`).
 *  - text answers ("stopped", "restarted") are plain text on deno and JSON
 *    strings on the monitor.
 *  - Prysm's monitor answers a failed start/stop with HTTP 200 and the body
 *    "failed"; the others use HTTP 500.
 * Settings writes are full-object overwrites that restart the client, so
 * callers should use `saveSettingsMerged` (settings.ts), not `saveSettings`.
 */
import type { ClientConfig } from "../config/clientConfig";
import { ApiError } from "./errors";
import { createHttp, errorDetail, type AdapterDeps } from "./http";
import type { PackageBackend, ProcessInfo, ServiceAction, Settings } from "./types";

/** Saving settings and service actions stop and start the client: allow for a slow stop. */
export const SLOW_TIMEOUT_MS = 120_000;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Undo the monitor's double encoding: a JSON string that holds JSON. */
function decodeNested(data: unknown): unknown {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

export function createPackageBackend(
  config: Pick<ClientConfig, "apiUrl" | "backend">,
  deps: AdapterDeps = {},
): PackageBackend {
  const http = createHttp({ baseUrl: config.apiUrl, service: "backend", fetch: deps.fetch });

  const settingsObject = async (path: string): Promise<Settings> => {
    const { status, data } = await http.request(path);
    const value = decodeNested(data);
    if (!isPlainObject(value)) {
      throw new ApiError({ kind: "invalid", service: "backend", path, status, detail: "settings are not a JSON object" });
    }
    return value as Settings;
  };

  return {
    getSettings: () => settingsObject("/settings"),

    getDefaultSettings: () => settingsObject("/defaultsettings"),

    async saveSettings(s) {
      await http.request("/settings", { method: "POST", body: s, timeoutMs: SLOW_TIMEOUT_MS });
    },

    async service(action: ServiceAction) {
      const path = `/service/${action}`;
      const { status, data } = await http.request(path, { method: "POST", timeoutMs: SLOW_TIMEOUT_MS });
      if (decodeNested(data) === "failed") {
        throw new ApiError({ kind: "http", service: "backend", path, status, detail: errorDetail(decodeNested(data)) });
      }
    },

    async serviceStatus() {
      const path = "/service/status";
      const { status, data } = await http.request(path);
      const value = decodeNested(data);
      if (!Array.isArray(value)) {
        throw new ApiError({ kind: "invalid", service: "backend", path, status, detail: "process list is not an array" });
      }
      return value as ProcessInfo[];
    },
  };
}
