import type { RocketpoolApi } from "./types";

/** The package backend's status route, served on the UI's own origin. */
export const STATUS_PATH = "/api/avado/status";

/** Adapters for the package backend (same origin as the UI). */
export function createRealRocketpoolApi(fetchImpl: typeof fetch = (...args) => fetch(...args)): RocketpoolApi {
  return {
    async ping() {
      try {
        const res = await fetchImpl(STATUS_PATH, { headers: { Accept: "application/json" } });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
