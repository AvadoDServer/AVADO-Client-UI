import { useRef, useState } from "react";
import { Button, Card, CardDescription, CardTitle, Input } from "../../../../components/ui";
import { adminPackageUrl } from "../../../../components/shell/links";
import { plainError } from "../../api/errors";
import { APPROVE_CONFIRMATION, type ReconcileKey, type ReconcileStatus } from "../../api/models";
import { reconcileStatusOf } from "../../api/reconcile";
import { useRocketpoolApi } from "../../api/RocketpoolApiProvider";
import { ExternalLink, Notice } from "../../components/common";
import { validatorUrl } from "../../lib/explorer";
import { shortAddress } from "../../lib/units";
import { useAppStatus } from "../../status/AppStatus";

/** The exact warning the owner reads before approving (backend T3 contract). */
export const SLASHING_WARNING =
  "Only do this if these validators are not running anywhere else — running a key on two machines gets it slashed.";

const shortKey = (pk: string) => `0x${pk.slice(0, 8)}…${pk.slice(-4)}`;

const timeOf = (iso: string | undefined): string | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Megapool validator 3" / "Minipool 0x1234…abcd". */
function keyLabel(v: ReconcileKey | undefined): string {
  if (!v) return "Validator";
  return v.kind === "megapool" ? `Megapool validator ${v.ref}` : `Minipool ${v.ref.startsWith("0x") ? shortAddress(v.ref) : v.ref}`;
}

function KeyList({ keys, status, extra }: { keys: string[]; status: ReconcileStatus; extra?: (v: ReconcileKey | undefined) => string | null }) {
  const byKey = new Map(status.validators.map((v) => [v.pubkey, v]));
  return (
    <ul className="flex min-w-0 flex-col gap-1.5 text-sm [overflow-wrap:anywhere]">
      {keys.map((pk) => {
        const v = byKey.get(pk);
        const href = validatorUrl(pk);
        const more = extra?.(v);
        return (
          <li key={pk} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-fg">{keyLabel(v)}</span>
            {href ? (
              <ExternalLink href={href} className="font-mono text-[0.8125rem] font-medium">
                {shortKey(pk)}
              </ExternalLink>
            ) : (
              <span className="font-mono text-[0.8125rem]">{shortKey(pk)}</span>
            )}
            {more && <span className="text-fg-muted">{more}</span>}
          </li>
        );
      })}
    </ul>
  );
}

interface Approved {
  count: number;
  /** The keys sent (normalised, as in the status). */
  pubkeys: string[];
  /** The key check's `finishedAt` when the approval was sent: a newer one means it ran since. */
  before: string | null;
}

/**
 * The validator keys that need the owner (the approval screen of the
 * key-check loop): keys waiting for approval to be loaded, keys about to
 * load, keys loaded in two clients, and a client too old to load keys into.
 */
export function KeyApproval() {
  const api = useRocketpoolApi();
  const { reconcile, refresh } = useAppStatus();
  const status = reconcileStatusOf(reconcile);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState<Approved | null>(null);
  const sending = useRef(false);

  if (!status) return null;
  const awaiting = status.awaitingApproval;
  const twice = status.loadedTwice;
  const settling = status.validators.filter((v) => v.state === "settling");
  const updateNeeded = status.validators.filter((v) => v.state === "client-update-needed");
  if (awaiting.length === 0 && twice.length === 0 && settling.length === 0 && updateNeeded.length === 0 && !approved) return null;

  const clientName = status.client?.name ?? "your consensus client";
  const packageName = (p: string) => status.clients.find((c) => c.package === p)?.name ?? p;
  const confirmOk = typed.trim() === APPROVE_CONFIRMATION;
  const n = awaiting.length;

  const approve = async () => {
    if (!confirmOk || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      // The owner's typed text goes to the backend as is: it checks it again.
      const res = await api.approveKeys(awaiting, typed.trim());
      setApproved({ count: res.approved, pubkeys: [...awaiting], before: status.finishedAt });
      setTyped("");
      await refresh();
    } catch (e) {
      setError(plainError(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const ranSince = approved && status.finishedAt && status.finishedAt !== approved.before;
  const outcome = approved ? approvalOutcome(status, approved.pubkeys, clientName) : null;

  return (
    <Card as="section" aria-labelledby="validator-keys-title" className="flex flex-col gap-4" data-testid="key-approval">
      <div>
        <CardTitle id="validator-keys-title">Validator keys</CardTitle>
        <CardDescription className="[overflow-wrap:anywhere]">{status.message}</CardDescription>
      </div>

      {twice.length > 0 && (
        <Notice tone="danger" title={twice.length === 1 ? "A key is loaded in two clients: remove it from one now" : `${twice.length} keys are loaded in two clients: remove them from one now`}>
          <p>
            Running a validator key in two clients at the same time gets it slashed: a penalty and a forced exit. Rocket Pool never
            removes keys itself. Open one of the clients in the AVADO Admin and remove the key there.
          </p>
          <ul className="flex flex-col gap-1">
            {twice.map((t) => (
              <li key={t.pubkey}>
                <span className="font-mono text-[0.8125rem]">{shortKey(t.pubkey)}</span> is in{" "}
                {t.packages.map((p, i) => (
                  <span key={p}>
                    {i > 0 && " and "}
                    <ExternalLink href={adminPackageUrl(p)}>{packageName(p)}</ExternalLink>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {updateNeeded.length > 0 && (
        <Notice tone="warning" title={`Update ${clientName} first`}>
          <p>
            This version of {clientName} can't have validator keys loaded into it safely. Update it from the AVADO Admin; Rocket Pool
            loads {updateNeeded.length === 1 ? "this key" : "these keys"} after that.
          </p>
          <KeyList keys={updateNeeded.map((v) => v.pubkey)} status={status} />
          {status.client && <ExternalLink href={adminPackageUrl(status.client.package)}>Open {clientName} in the AVADO Admin</ExternalLink>}
        </Notice>
      )}

      {settling.length > 0 && (
        <Notice tone="accent" title={`${plural(settling.length, "key")} will be loaded soon`}>
          <p>
            To be safe from double signing, Rocket Pool first waits a while to make sure {settling.length === 1 ? "it isn't" : "they aren't"}{" "}
            running anywhere else.
          </p>
          <KeyList
            keys={settling.map((v) => v.pubkey)}
            status={status}
            extra={(v) => {
              const t = timeOf(v?.settlesAt);
              return t ? `loads at about ${t}` : "loads soon";
            }}
          />
        </Notice>
      )}

      {n > 0 && (
        <div className="flex flex-col gap-3" data-testid="awaiting-approval">
          <p className="text-sm font-semibold text-fg">
            {plural(n, "key")} {n === 1 ? "is" : "are"} not loaded in {clientName} and {n === 1 ? "waits" : "wait"} for your approval
          </p>
          <KeyList keys={awaiting} status={status} />
          {status.clientChoice?.why && <p className="text-sm text-fg-muted">Why {clientName}: {status.clientChoice.why}</p>}
          <Notice tone="warning" title={SLASHING_WARNING}>
            <p>
              For example, if you moved these validators to another machine or service, don't load them here. Rocket Pool keeps checking
              every few minutes and asks again if a key goes missing later.
            </p>
          </Notice>
          {status.importBlockedReasons.length > 0 && (
            <Notice tone="neutral" title="They can't be loaded right now, even after you approve:">
              <ul className="list-disc pl-5">
                {status.importBlockedReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Notice>
          )}
          <Input
            label={
              <>
                Type <span className="font-mono font-semibold text-fg">{APPROVE_CONFIRMATION}</span> to confirm
              </>
            }
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="max-w-xs"
          />
          <div>
            <Button variant="primary" onClick={approve} disabled={!confirmOk} loading={busy}>
              Load {plural(n, "validator key")} into {clientName}
            </Button>
          </div>
          {error && (
            <Notice tone="danger" title="Not approved" live>
              <p>{error}</p>
            </Notice>
          )}
        </div>
      )}

      {approved && (
        <Notice tone={outcome!.tone} title={`Approved ${plural(approved.count, "key")}`} live testId="approval-outcome">
          <p>{outcome!.text}</p>
          {outcome!.reasons.length > 0 && (
            <ul className="list-disc pl-5">
              {outcome!.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {ranSince && (
            <p>
              Checked again{timeOf(status.finishedAt ?? undefined) ? ` at ${timeOf(status.finishedAt ?? undefined)}` : ""}: {status.message}
            </p>
          )}
        </Notice>
      )}
    </Card>
  );
}

/** How long the backend waits before loading a key it has never seen in a client (T3 SETTLE_MS). */
export const SETTLE_MINUTES = 20;

/**
 * What will really happen to approved keys, from the latest status: loaded,
 * blocked (and why), waiting out the safety delay (until when), or the next check.
 */
export function approvalOutcome(
  status: ReconcileStatus,
  pubkeys: string[],
  clientName: string,
): { tone: "success" | "warning" | "accent"; text: string; reasons: string[] } {
  const mine = status.validators.filter((v) => pubkeys.includes(v.pubkey));
  const them = pubkeys.length === 1 ? "it" : "them";
  const running = mine.filter((v) => v.state === "loaded" || v.state === "imported");
  if (mine.length > 0 && running.length === mine.length) {
    return { tone: "success", text: `Loaded into ${clientName}.`, reasons: [] };
  }
  if (status.importBlockedReasons.length > 0) {
    return {
      tone: "warning",
      text: `Rocket Pool can't load ${them} yet. ${pubkeys.length === 1 ? "It loads" : "They load"} once this is fixed:`,
      reasons: status.importBlockedReasons.slice(0, 5),
    };
  }
  const settling = mine.filter((v) => v.state === "settling");
  if (settling.length > 0) {
    const times = settling.map((v) => timeOf(v.settlesAt)).filter((t): t is string => !!t).sort();
    const when = times.length ? ` (around ${times[times.length - 1]})` : "";
    return { tone: "accent", text: `Keys load after a ${SETTLE_MINUTES}-minute safety wait${when}.`, reasons: [] };
  }
  return {
    tone: "accent",
    text: `Rocket Pool loads ${them} into ${clientName} within a few minutes. A key that was never seen in a client first gets a ${SETTLE_MINUTES}-minute safety wait.`,
    reasons: [],
  };
}

export default KeyApproval;
