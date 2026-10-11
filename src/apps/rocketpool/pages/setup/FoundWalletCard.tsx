import { useId, useRef, useState } from "react";
import { Button } from "../../../../components/ui";
import { isOutcomeUnknown, isRpApiError, plainError } from "../../api/errors";
import type { AdoptWalletResult, FoundWallet } from "../../api/models";
import { useRocketpoolApi } from "../../api/RocketpoolApiProvider";
import { Address, Notice, TechDetails } from "../../components/common";
import { formatDate, parseTime } from "../../lib/time";
import { useAppStatus } from "../../status/AppStatus";

/** At most this many copies are offered: the backend lists the newest first. */
export const MAX_FOUND_SHOWN = 3;

/** Where the copy is, in words: a folder name is the only path an owner sees. */
export function foundWhere(w: FoundWallet): string {
  if (w.source === "backup") return "In an automatic backup";
  if (w.dir === "") return "At the top of the package's storage";
  return `In the folder ${w.dir}`;
}

type Outcome = { ok: true; result: AdoptWalletResult } | { ok: false; error: unknown; unclear: boolean };

/**
 * A wallet the backend found elsewhere on this AVADO (an automatic backup, an
 * old folder), usually after an update: one click copies it back into the
 * folder the daemon uses (`POST /api/avado/wallet/adopt`), nothing to type.
 * `onStart`/`onFinish` let the wallet step keep this card, and its outcome,
 * on screen while the status catches up.
 */
export function FoundWalletCard({
  wallets,
  walletReady = false,
  onStart,
  onFinish,
}: {
  wallets: FoundWallet[];
  /** A wallet is in place now: an unclear outcome has settled itself. */
  walletReady?: boolean;
  onStart?: () => void;
  onFinish?: (ok: boolean) => void;
}) {
  const api = useRocketpoolApi();
  const { refresh } = useAppStatus();
  const [busyDir, setBusyDir] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const inFlight = useRef(false);
  const id = useId();
  const busy = busyDir !== null;

  const adopt = async (dir: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyDir(dir);
    setOutcome(null);
    onStart?.();
    try {
      let result: AdoptWalletResult;
      try {
        result = await api.adoptFoundWallet(dir);
      } catch (e) {
        const unclear = isOutcomeUnknown(e);
        setOutcome({ ok: false, error: e, unclear });
        onFinish?.(false);
        // The list or the wallet changed under us (400, 409), or we can't tell: read the status again.
        if (unclear || (isRpApiError(e) && (e.status === 400 || e.status === 409))) void refresh();
        return;
      }
      setOutcome({ ok: true, result });
      onFinish?.(true);
      await refresh();
    } finally {
      inFlight.current = false;
      setBusyDir(null);
    }
  };

  const shown = wallets.slice(0, MAX_FOUND_SHOWN);

  const failure =
    outcome && !outcome.ok ? (
      outcome.unclear ? (
        !walletReady && (
          <Notice tone="neutral" title="Not sure whether it worked" live>
            <p>This page updates by itself once the wallet shows up. Trying again is safe: a wallet that is already back is never replaced.</p>
            <TechDetails error={outcome.error} />
          </Notice>
        )
      ) : (
        <Notice tone="danger" title="The wallet was not put back" live>
          <p>{plainError(outcome.error)}</p>
          <TechDetails error={outcome.error} />
        </Notice>
      )
    ) : null;

  // Nothing left to offer (the list changed after a refusal): only the outcome.
  if (!outcome?.ok && shown.length === 0) return failure || null;

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3 rounded-xl border border-accent/25 bg-accent-subtle p-4" data-testid="found-wallet">
      <div>
        <p id={`${id}-title`} className="text-[0.9375rem] font-semibold text-fg">
          We found a wallet on this AVADO
        </p>
        <p className="mt-1 text-sm text-fg">This copies the wallet and its keys into the folder the app uses and leaves the original where it is.</p>
      </div>

      {outcome?.ok ? (
        outcome.result.restarted === false ? (
          <Notice tone="success" title="Your wallet is back." live>
            <p>Rocket Pool could not restart by itself: restart the Rocket Pool package in the AVADO Admin.</p>
            {outcome.result.restartError && <TechDetails lines={[outcome.result.restartError]} />}
          </Notice>
        ) : (
          <Notice tone="success" title="Your wallet is back. Rocket Pool is restarting, this takes about a minute." live />
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((w, i) => {
            const time = parseTime(w.modifiedAt);
            const rowId = `${id}-row-${i}`;
            return (
              <li key={w.dir} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center">
                <div id={rowId} className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
                  <span className="font-semibold text-fg [overflow-wrap:anywhere]">{foundWhere(w)}</span>
                  {w.address ? <Address value={w.address} /> : <span className="text-fg-muted">Address unknown</span>}
                  <span className="flex flex-wrap gap-x-3 text-xs text-fg-muted">
                    {time !== null && <span>Made/changed {formatDate(time)}</span>}
                    {w.hasValidators && <span>Includes validator keys</span>}
                  </span>
                </div>
                <Button
                  variant={i === 0 ? "primary" : "secondary"}
                  className="flex-shrink-0 self-start sm:self-center"
                  onClick={() => void adopt(w.dir)}
                  loading={busyDir === w.dir}
                  disabled={busy}
                  aria-describedby={rowId}
                >
                  Use this wallet
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {failure}
    </section>
  );
}

export default FoundWalletCard;
