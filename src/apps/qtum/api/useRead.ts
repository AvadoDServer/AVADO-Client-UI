import { usePoll, type PollResult } from "../../../hooks/usePoll";
import { useQtumApi } from "./QtumApiProvider";
import type { QtumApi } from "./types";

/** How often the pages re-read the wallet (ms), as the old wizard did. */
export const PAGE_READ_MS = 15_000;

/**
 * A read for a page, polled while the page is open. `enabled` false (e.g.
 * the wallet isn't ready) keeps it from asking at all.
 */
export function useRead<T>(
  fn: (api: QtumApi) => Promise<T>,
  { enabled = true, intervalMs = PAGE_READ_MS, key }: { enabled?: boolean; intervalMs?: number; key?: string } = {},
): PollResult<T> {
  const api = useQtumApi();
  return usePoll(() => fn(api), intervalMs, { enabled, key });
}
