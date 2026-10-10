import { usePoll, type PollResult } from "../../../hooks/usePoll";
import { useRocketpoolApi } from "./RocketpoolApiProvider";
import type { RocketpoolApi } from "./types";

/** How often the pages re-read Smartnode (ms): chain state changes slowly, and node/status is heavy. */
export const PAGE_READ_MS = 60_000;

/**
 * A Smartnode read for a page, polled while the page is open. `enabled`
 * false (e.g. the daemon isn't ready) keeps it from asking at all.
 */
export function useRead<T>(
  fn: (api: RocketpoolApi) => Promise<T>,
  { enabled = true, intervalMs = PAGE_READ_MS, key }: { enabled?: boolean; intervalMs?: number; key?: string } = {},
): PollResult<T> {
  const api = useRocketpoolApi();
  return usePoll(() => fn(api), intervalMs, { enabled, key });
}
