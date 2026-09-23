import type { RocketpoolApi } from "./types";

export interface RocketpoolMockOptions {
  /** Simulated latency per call (ms). */
  latencyMs?: number;
  /** The backend is down. */
  backendDown?: boolean;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** In-memory adapters for `VITE_MOCK=1` and tests. */
export function createMockRocketpoolApi({ latencyMs = 0, backendDown = false }: RocketpoolMockOptions = {}): RocketpoolApi {
  return {
    async ping() {
      if (latencyMs > 0) await wait(latencyMs);
      return !backendDown;
    },
  };
}
