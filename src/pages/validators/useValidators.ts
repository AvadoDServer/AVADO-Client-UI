import { useRef } from "react";
import { useApi } from "../../api/ApiProvider";
import type { Api, ValidatorState } from "../../api/types";
import { POLL_MS, usePoll } from "../../hooks/usePoll";

export interface ValidatorRowData {
  pubkey: string;
  /** The keymanager can't remove read-only keys (for example remote signer keys). */
  readonly: boolean;
  /**
   * What the beacon node says: a record, `null` when it doesn't know the key
   * yet (HTTP 404, waiting for deposit), `undefined` when it didn't answer.
   */
  state: ValidatorState | null | undefined;
  /**
   * What the keymanager reports as this key's fee recipient: the override or
   * the default. `null` when it has none, `undefined` when it didn't answer.
   */
  feeRecipient: string | null | undefined;
}

export interface ValidatorsData {
  rows: ValidatorRowData[];
  /** `validators_proposer_default_fee_recipient`, "" when not set. */
  defaultFeeRecipient: string;
  /** False when the settings could not be read (the default is then unknown). */
  settingsLoaded: boolean;
}

/** Run `fn` over `items` with at most `limit` calls in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const indexOf = (r: ValidatorRowData) => (r.state ? Number(r.state.index) : Number.POSITIVE_INFINITY);

/** Known validators by index first, then the ones the beacon chain doesn't know yet. */
export function sortRows(rows: ValidatorRowData[]): ValidatorRowData[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => indexOf(a.r) - indexOf(b.r) || a.i - b.i)
    .map((x) => x.r);
}

/**
 * Load every key the keymanager has plus what the beacon node and the
 * keymanager say about each. Rejects only when the key list itself can't be
 * read (the client is starting or unreachable); per-key failures become
 * `undefined` fields and keep the last known value from `previous`.
 */
export async function loadValidators(api: Api, previous?: ValidatorsData | null): Promise<ValidatorsData> {
  const keystores = await api.keymanager.listKeystores();
  const settings = await api.backend.getSettings().then(
    (s) => s,
    () => null,
  );
  const defaultFeeRecipient =
    settings !== null
      ? String(settings.validators_proposer_default_fee_recipient ?? "")
      : (previous?.defaultFeeRecipient ?? "");
  const prev = new Map((previous?.rows ?? []).map((r) => [r.pubkey.toLowerCase(), r]));

  const rows = await mapLimit(keystores, 8, async (k): Promise<ValidatorRowData> => {
    const pubkey = k.validating_pubkey;
    const [state, feeRecipient] = await Promise.all([
      api.beacon.validator(pubkey).then(
        (v) => v,
        () => undefined,
      ),
      api.keymanager.getFeeRecipient(pubkey).then(
        (f) => f,
        () => undefined,
      ),
    ]);
    const last = prev.get(pubkey.toLowerCase());
    return {
      pubkey,
      readonly: !!k.readonly,
      state: state === undefined && last ? last.state : state,
      feeRecipient: feeRecipient === undefined && last ? last.feeRecipient : feeRecipient,
    };
  });

  return {
    rows: sortRows(rows),
    defaultFeeRecipient,
    settingsLoaded: settings !== null || !!previous?.settingsLoaded,
  };
}

export interface UseValidators {
  data: ValidatorsData | null;
  /** The last refresh failed. `data` still holds the last good result. */
  error: Error | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Validators with the shared poll (`usePoll`): every `intervalMs` normally,
 * `retryMs` after a failure (then backing off), so the page recovers soon
 * after a client restart without a reload. Paused while the tab is hidden.
 */
export function useValidators(intervalMs: number = POLL_MS.validators, retryMs = 10_000): UseValidators {
  const api = useApi();
  const last = useRef<ValidatorsData | null>(null);
  const poll = usePoll(
    async () => {
      const next = await loadValidators(api, last.current);
      last.current = next;
      return next;
    },
    intervalMs,
    { retryMs },
  );
  const error = poll.error === undefined ? null : poll.error instanceof Error ? poll.error : new Error(String(poll.error));
  return { data: poll.data ?? null, error, loading: poll.loading, refresh: poll.refresh };
}
