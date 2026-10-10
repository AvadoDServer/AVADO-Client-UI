import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, Input, Modal, Spinner, StatusDot, cn } from "../../../components/ui";
import { useMode } from "../../../settings/ModeProvider";
import { TechDetails } from "../components/common";
import { isDefinitelyNotSent, isOutcomeUnknown, plainError } from "../api/errors";
import type { CanResponse, GasLimits, SnEnvelope, TxResponse } from "../api/models";
import { useRocketpoolApi } from "../api/RocketpoolApiProvider";
import { canFlag, getGasPrice } from "../api/sn";
import type { SnParams } from "../api/types";
import { isTxHash, txUrl } from "../lib/explorer";
import { formatGasCost, formatGwei } from "../lib/units";
import { gasParams, quoteGas, type GasQuote } from "./gas";
import { DISMISS_AFTER_MS, pendingKey, usePendingTxs, type PendingTx } from "./pending";

/** One Smartnode transaction: its `can-X` check and its `X` write. */
export interface TransactionSpec<C extends CanResponse = CanResponse> {
  /** The read route that checks it and estimates gas, e.g. `node/can-distribute`. */
  canRoute: string;
  /** The write route that sends it, e.g. `node/distribute`. */
  route: string;
  /** Parameters for both routes (e.g. `{ address }`). The gas fields are added to the write. */
  params?: SnParams;
  /**
   * Why it can't be done now, in plain words, from the check's answer; null
   * when it can. Default: the route's own flag (`node/can-deposit` →
   * `canDeposit`) being false, explained by Smartnode's reason flags.
   */
  blockedReason?: (can: C) => string | null;
  /** Extra summary lines from the check's answer (amounts, addresses). */
  details?: (can: C) => ReactNode;
  /** Where the answer holds the gas limits (default `gasLimits`). */
  gasLimits?: (can: C) => GasLimits | undefined;
  /** The write answer's field with the tx hash (default `txHash`). */
  txHashField?: string;
  /**
   * The pending-transaction lock for this action, when the route and its
   * parameters don't name it well (e.g. `megapool/exit-queue` names its
   * validator id `validatorIndex`). Default: `pendingKey(route, params)`.
   */
  lockKey?: string;
  /**
   * Not a transaction: Smartnode signs a message and hands it to the beacon
   * chain (a voluntary exit). No network fee, no gas fields, no tx hash; the
   * action is done when the write succeeds.
   */
  offChain?: OffChainSpec;
  /**
   * Gas of a second transaction Smartnode sends with this one (the close
   * bundle's fixed-limit second step). Shown in the fee, never sent as the limit.
   */
  extraGas?: { gas: number; label: string };
}

export interface OffChainSpec {
  /** Shown while it is being handed over, e.g. "Sending the exit request to the beacon chain…". */
  sendingText: string;
  /** The success note's title, e.g. "Exit requested". */
  doneTitle: string;
  doneText: ReactNode;
  /** How to check it if the answer got lost, e.g. "Check the validator on beaconcha.in: …". */
  checkText: ReactNode;
}

/** The lock an action takes in the pending-transaction store. */
export const specLockKey = (spec: Pick<TransactionSpec, "route" | "params" | "lockKey">): string =>
  spec.lockKey ?? pendingKey(spec.route, spec.params);

export interface TransactionFlowProps<C extends CanResponse = CanResponse> {
  open: boolean;
  /** The dialog title: the action, e.g. "Distribute your rewards". */
  title: string;
  /** What it does, in plain words. */
  summary: ReactNode;
  tx: TransactionSpec<C>;
  /** The confirm button, e.g. "Distribute". */
  confirmLabel: string;
  /** "danger" for irreversible actions. */
  tone?: "primary" | "danger";
  /** The owner must type this exact text before confirming (irreversible actions). */
  requireText?: string;
  /** Accept the typed text in any letter case (for a code derived from a checksummed address). */
  requireTextIgnoreCase?: boolean;
  /**
   * Confirm stays disabled this long after the summary shows (ms), so the
   * second click of a double click that opened the dialog can't confirm.
   */
  armDelayMs?: number;
  /** A summary older than this is checked again before sending (ms). */
  maxQuoteAgeMs?: number;
  onClose: () => void;
  /**
   * The transaction was mined and succeeded (also when the dialog was closed
   * meanwhile). For an off-chain action: it was accepted, and `txHash` is "".
   */
  onDone?: (txHash: string) => void;
}

export const DEFAULT_ARM_DELAY_MS = 800;
export const DEFAULT_MAX_QUOTE_AGE_MS = 60_000;

/** What was checked, frozen: exactly this is sent. */
interface Checked<C> {
  route: string;
  params: SnParams;
  lockKey: string;
  txHashField: string;
  details?: (can: C) => ReactNode;
  offChain?: OffChainSpec;
}

type Phase<C> =
  | { k: "checking"; stale?: boolean }
  | { k: "check-error"; message: string; error: unknown }
  | { k: "blocked"; reason: string }
  /** `quote` is null only for an off-chain action (no fee). */
  | { k: "ready"; can: C; quote: GasQuote | null; spec: Checked<C>; checkedAt: number; stale?: boolean }
  /** The write was refused: `certain` when the backend refused before the daemon saw it. */
  | { k: "send-failed"; message: string; certain: boolean; error: unknown }
  /** Showing the app's record of this action (sending, sent, unclear, lost, done, failed). */
  | { k: "tracked" };

/** The owner typed the confirmation text (exactly, or in any case when allowed). */
function typedMatches(typed: string, required: string | undefined, ignoreCase: boolean): boolean {
  if (required === undefined) return true;
  const t = typed.trim();
  return ignoreCase ? t.toLowerCase() === required.toLowerCase() : t === required;
}

/** Smartnode's reason flags on `can-X` answers, in plain words. */
const REASONS: Array<[string, string]> = [
  ["insufficientBalance", "The node wallet doesn't have enough ETH for this. Add ETH to it first."],
  ["insufficientRplBalance", "The node wallet doesn't have enough RPL for this."],
  ["depositDisabled", "Rocket Pool isn't taking new deposits right now."],
  ["nodeHasDebt", "Your megapool has a debt to repay first (on the Validators page)."],
  ["invalidAmount", "This amount isn't allowed."],
  ["alreadyRegistered", "This node is already registered."],
  ["registrationDisabled", "Rocket Pool isn't registering new nodes right now."],
  ["inConsensus", "The network is still settling this; try again later."],
  ["insufficientRplStake", "Your node doesn't have enough RPL staked for this."],
  ["unstakingPeriodActive", "The unstaking period hasn't ended yet."],
];

/**
 * Default rule: only the flag named after the route counts (`canDeposit` for
 * `node/can-deposit`). Other `can…` fields are information (e.g. deposits'
 * `canUseCredit`) and never block.
 */
export function defaultBlockedReason(can: CanResponse, canRoute: string): string | null {
  const flag = canFlag(canRoute);
  if (!flag || can[flag] !== false) return null;
  const reason = REASONS.find(([k]) => can[k] === true);
  return reason ? reason[1] : "Rocket Pool says this can't be done right now. Try again later.";
}

function TxLink({ hash }: { hash?: string }) {
  const href = hash ? txUrl(hash) : null;
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-semibold text-accent underline-offset-2 hover:underline"
    >
      View the transaction on Etherscan
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

type NoteTone = "danger" | "warning" | "success" | "accent";

function Note({ tone, title, children, noteRef }: { tone: NoteTone; title: string; children?: ReactNode; noteRef?: React.Ref<HTMLDivElement> }) {
  const box = {
    danger: "border-danger/25 bg-danger-subtle",
    warning: "border-warning/25 bg-warning-subtle",
    success: "border-success/25 bg-success-subtle",
    accent: "border-accent/25 bg-accent-subtle",
  }[tone];
  return (
    <div
      ref={noteRef}
      tabIndex={-1}
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn("mt-4 flex gap-3 rounded-xl border p-4 focus:outline-none", box)}
    >
      <StatusDot tone={tone} className="mt-1.5" />
      <div className="min-w-0 text-sm text-fg">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-1 flex flex-col gap-2 break-words">{children}</div>}
      </div>
    </div>
  );
}

const currentPage = () => {
  try {
    const path = window.location.hash.replace(/^#/, "").split("?")[0];
    return path.startsWith("/") ? path : "/";
  } catch {
    return "/";
  }
};

/**
 * The one way the app sends a transaction:
 * check (`can-X` + gas price) → plain summary and fee → explicit confirm →
 * send (`X`) → wait until mined → done or failed, with an explorer link.
 *
 * Accidental and double sends are made impossible:
 * - Confirm exists only once the check passed and the fee is known; it is
 *   disabled for `armDelayMs`, and works once per check (a synchronous guard).
 * - Exactly the checked route and parameters are sent; a summary older than
 *   `maxQuoteAgeMs` is checked again first.
 * - Before the request goes out, the action is recorded in the app's
 *   pending-transaction store (saved in the browser). While it is sending,
 *   sent, unclear or lost, the same action can't be started from any dialog,
 *   page or reload; the dialog shows that record instead.
 */
export function TransactionFlow<C extends CanResponse = CanResponse>({
  open,
  title,
  summary,
  tx,
  confirmLabel,
  tone = "primary",
  requireText,
  requireTextIgnoreCase = false,
  armDelayMs = DEFAULT_ARM_DELAY_MS,
  maxQuoteAgeMs = DEFAULT_MAX_QUOTE_AGE_MS,
  onClose,
  onDone,
}: TransactionFlowProps<C>) {
  const api = useRocketpoolApi();
  const pending = usePendingTxs();
  const [phase, setPhase] = useState<Phase<C>>({ k: "checking" });
  const [armed, setArmed] = useState(false);
  const [typed, setTyped] = useState("");
  /** The action this dialog shows: the props' until checked, then the checked one. */
  const [key, setKey] = useState(() => specLockKey(tx));
  /** Bumped on every (re)start and on close: late answers of an older run are ignored. */
  const run = useRef(0);
  /** Set the moment the write is fired; cleared only by a fresh check. */
  const sent = useRef(false);
  const noteRef = useRef<HTMLDivElement>(null);
  const hintId = useId();

  const txRef = useRef(tx);
  txRef.current = tx;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const entry: PendingTx | undefined = pending.get(key);
  const showEntry =
    !!entry && (phase.k === "tracked" || (phase.k !== "ready" && phase.k !== "send-failed" && pending.isBlocking(key)));

  const check = useCallback(
    async (stale = false) => {
      const id = ++run.current;
      sent.current = false;
      setArmed(false);
      const spec = txRef.current;
      const params = { ...(spec.params ?? {}) };
      const frozen: Checked<C> = {
        route: spec.route,
        params,
        lockKey: specLockKey({ route: spec.route, params, lockKey: spec.lockKey }),
        txHashField: spec.txHashField ?? "txHash",
        details: spec.details,
        offChain: spec.offChain,
      };
      const frozenKey = frozen.lockKey;
      setKey(frozenKey);
      if (pending.isBlocking(frozenKey)) return setPhase({ k: "tracked" });
      setPhase({ k: "checking", stale });
      try {
        const [can, gas] = await Promise.all([
          api.snGet<C>(spec.canRoute, frozen.params),
          frozen.offChain ? Promise.resolve(null) : getGasPrice(api),
        ]);
        if (id !== run.current) return;
        const reason = spec.blockedReason ? spec.blockedReason(can) : defaultBlockedReason(can, spec.canRoute);
        if (reason) return setPhase({ k: "blocked", reason });
        if (frozen.offChain) return setPhase({ k: "ready", can, quote: null, spec: frozen, checkedAt: Date.now(), stale });
        const quote = quoteGas(
          spec.gasLimits ? spec.gasLimits(can) : can.gasLimits,
          gas?.gasPrice,
          undefined,
          spec.extraGas?.gas ?? 0,
        );
        if (!quote) {
          return setPhase({
            k: "blocked",
            reason: "The network fee could not be estimated, so nothing can be sent right now. Try again in a few minutes.",
          });
        }
        setPhase({ k: "ready", can, quote, spec: frozen, checkedAt: Date.now(), stale });
      } catch (e) {
        if (id === run.current) setPhase({ k: "check-error", message: plainError(e), error: e });
      }
    },
    [api, pending],
  );

  // On open: show this action's record if it is still in flight or unclear;
  // acknowledge a finished one and check afresh.
  useEffect(() => {
    if (!open) return;
    setTyped("");
    const k = specLockKey(txRef.current);
    setKey(k);
    const e = pending.get(k);
    if (e && (e.state === "done" || e.state === "failed")) pending.dismiss(k);
    if (pending.isBlocking(k)) {
      run.current += 1;
      setPhase({ k: "tracked" });
      if (!pending.isOverdue(k)) pending.follow(k); // no-op when already followed; an overdue tx waits for the owner
    } else {
      void check();
    }
    return () => {
      run.current += 1;
    };
    // Only on open/close: later prop changes don't restart a check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Confirm works only after the summary has been on screen for a moment.
  const readyAt = phase.k === "ready" ? phase.checkedAt : null;
  useEffect(() => {
    if (readyAt === null) return;
    setArmed(armDelayMs <= 0);
    if (armDelayMs <= 0) return;
    const t = setTimeout(() => setArmed(true), armDelayMs);
    return () => clearTimeout(t);
  }, [readyAt, armDelayMs]);

  // After a change of state, move focus to the note that explains it (the button that was focused may be gone).
  const focusKey = showEntry ? `entry:${entry?.state}` : phase.k;
  useEffect(() => {
    if (!open || focusKey === "ready" || focusKey === "checking") return;
    noteRef.current?.focus();
  }, [open, focusKey]);

  const confirm = async () => {
    if (phase.k !== "ready" || !armed || sent.current) return;
    if (!typedMatches(typed, requireText, requireTextIgnoreCase)) return;
    if (Date.now() - phase.checkedAt > maxQuoteAgeMs) {
      void check(true); // too old: fees and eligibility may have changed
      return;
    }
    const { spec, quote } = phase;
    const k = spec.lockKey;
    sent.current = true; // before any await: a second click can't get past this
    // Recorded before the request, so no other dialog, page or reload can start it again.
    if (!pending.begin({ key: k, title, route: spec.route, params: spec.params, page: currentPage() })) {
      setKey(k);
      setPhase({ k: "tracked" });
      return;
    }
    const id = run.current;
    setKey(k);
    setPhase({ k: "tracked" });
    let res: TxResponse;
    try {
      const body = quote ? { ...spec.params, ...gasParams(quote) } : { ...spec.params };
      res = await api.snPost<TxResponse & SnEnvelope>(spec.route, body);
    } catch (e) {
      // Always record the outcome, even if this dialog was closed meanwhile.
      if (isOutcomeUnknown(e)) {
        pending.markUnknown(k, plainError(e));
      } else {
        pending.markNotSent(k);
        if (id === run.current) setPhase({ k: "send-failed", message: plainError(e), certain: isDefinitelyNotSent(e), error: e });
      }
      return;
    }
    if (spec.offChain) {
      // Accepted by the beacon node: there is no transaction to follow.
      pending.markFinished(k);
      onDoneRef.current?.("");
      return;
    }
    const hash = res[spec.txHashField];
    if (!isTxHash(hash)) {
      pending.markUnknown(k, "Rocket Pool accepted the request but did not return a transaction hash.");
      return;
    }
    pending.markSent(k, hash, (h) => onDoneRef.current?.(h));
  };

  const close = () => {
    // A finished record has been seen: forget it, so the next open checks afresh.
    const e = pending.get(key);
    if (e && (e.state === "done" || e.state === "failed")) pending.dismiss(key);
    onClose();
  };

  const entryState = showEntry ? entry?.state : undefined;
  const sending = entryState === "sending";
  const typedOk = typedMatches(typed, requireText, requireTextIgnoreCase);
  const confirmHint =
    phase.k === "ready" && !armed
      ? "Confirm becomes available in a moment."
      : phase.k === "ready" && !typedOk
        ? `Type ${requireText} above to enable ${confirmLabel}.`
        : null;
  // An unclear entry becomes dismissable after the age limit: re-render now and then while one is shown.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!open || (entryState !== "unknown" && entryState !== "lost" && entryState !== "sent")) return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [open, entryState]);
  const overdue = showEntry && pending.isOverdue(key);
  const dismissable = showEntry && pending.canDismiss(key) && (overdue || entryState === "unknown" || entryState === "lost");

  let footer: ReactNode;
  if (showEntry) {
    footer = (
      <>
        {dismissable && (
          <Button
            variant="secondary"
            pill
            onClick={() => {
              if (pending.dismiss(key)) void check();
            }}
          >
            I've checked: stop tracking it
          </Button>
        )}
        {overdue && (
          <Button variant="primary" pill onClick={() => pending.keepWaiting(key)}>
            Keep waiting
          </Button>
        )}
        {entryState === "lost" && !overdue && (
          <Button variant="secondary" pill onClick={() => pending.follow(key, { restart: true })}>
            Check the transaction again
          </Button>
        )}
        <Button variant={entryState === "done" ? "primary" : "secondary"} pill onClick={close} disabled={sending}>
          {entryState === "done" ? "Done" : "Close"}
        </Button>
      </>
    );
  } else if (phase.k === "ready") {
    footer = (
      <>
        <Button variant="secondary" pill onClick={close}>
          Cancel
        </Button>
        <Button
          variant={tone}
          pill
          onClick={confirm}
          disabled={!armed || !typedOk}
          aria-describedby={confirmHint ? hintId : undefined}
        >
          {confirmLabel}
        </Button>
      </>
    );
  } else if (phase.k === "check-error" || phase.k === "send-failed") {
    footer = (
      <>
        <Button variant="secondary" pill onClick={close}>
          Close
        </Button>
        <Button variant="primary" pill onClick={() => void check()}>
          Check again
        </Button>
      </>
    );
  } else {
    footer = (
      <Button variant="secondary" pill onClick={close}>
        {phase.k === "checking" ? "Cancel" : "Close"}
      </Button>
    );
  }

  const startedElsewhere = showEntry && entry && sent.current === false;

  return (
    <Modal open={open} onClose={sending ? undefined : close} title={title} size="md" closeOnBackdrop={!sending} footer={footer}>
      <div className="text-sm text-fg-muted">{summary}</div>

      {showEntry && entry ? (
        <EntryNote
          entry={entry}
          noteRef={noteRef}
          startedElsewhere={!!startedElsewhere}
          overdue={overdue}
          offChain={txRef.current.offChain}
        />
      ) : (
        <>
          {phase.k === "checking" && (
            <p className="mt-4 flex items-center gap-2 text-sm text-fg-muted">
              <Spinner size="sm" label="Checking" /> Checking with Rocket Pool and estimating the network fee…
            </p>
          )}

          {phase.k === "check-error" && (
            <Note tone="danger" title="Could not check this transaction" noteRef={noteRef}>
              <p>{phase.message}</p>
              <p>Nothing was sent. Press Check again to retry.</p>
              <TechDetails error={phase.error} />
            </Note>
          )}

          {phase.k === "blocked" && (
            <Note tone="warning" title="This can't be done right now" noteRef={noteRef}>
              <p>{phase.reason}</p>
              <p>Nothing was sent and no fee was paid.</p>
            </Note>
          )}

          {phase.k === "ready" && (
            <>
              {phase.stale && (
                <p className="mt-4 text-sm font-medium text-fg" role="status">
                  The fee estimate was more than a minute old, so it was checked again. Look it over and confirm.
                </p>
              )}
              {phase.spec.details && <div className="mt-4 text-sm text-fg">{phase.spec.details(phase.can)}</div>}
              {phase.quote ? <FeeBox quote={phase.quote} extraLabel={txRef.current.extraGas?.label} /> : <NoFeeBox />}
              {requireText !== undefined && (
                <Input
                  className="mt-4"
                  label={
                    <>
                      Type <span className="font-mono font-semibold text-fg">{requireText}</span> to confirm
                    </>
                  }
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
              <p className="mt-4 text-xs text-fg-muted">Nothing is sent until you press {confirmLabel}.</p>
              {confirmHint && (
                <p id={hintId} className="sr-only">
                  {confirmHint}
                </p>
              )}
            </>
          )}

          {phase.k === "send-failed" && (
            <Note tone="danger" title="Not sent" noteRef={noteRef}>
              <p>{phase.message}</p>
              <p>{phase.certain ? "Nothing was sent and no fee was paid." : "It was most likely not sent, and no fee was paid for it."}</p>
              <TechDetails error={phase.error} />
            </Note>
          )}
        </>
      )}
    </Modal>
  );
}

/** An off-chain action (a signed exit): nothing is paid. */
function NoFeeBox() {
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-4 text-sm" data-testid="tx-no-fee">
      <p className="font-medium text-fg">No network fee</p>
      <p className="mt-1 text-xs text-fg-muted">
        Your node signs an exit message and hands it to the network. It isn't a transaction, so there is nothing to pay.
      </p>
    </div>
  );
}

function FeeBox({ quote, extraLabel }: { quote: GasQuote; extraLabel?: string }) {
  const { isAdvanced } = useMode();
  if (!isAdvanced) {
    return (
      <div className="mt-4 rounded-xl border border-border bg-surface p-4 text-sm" data-testid="tx-fee">
        <dl>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <dt className="font-medium text-fg">Network fee</dt>
            <dd className="font-semibold text-fg">about {formatGasCost(quote.estimatedCostWei)}</dd>
          </div>
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-fg-muted">
            <dt>At most</dt>
            <dd>{formatGasCost(quote.maxCostWei)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-fg-muted">
          Paid from your node wallet to the Ethereum network, not to AVADO or Rocket Pool. It never costs more than &ldquo;at most&rdquo;.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-4 text-sm" data-testid="tx-fee">
      <dl>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <dt className="font-medium text-fg">Network fee</dt>
          <dd className="font-semibold text-fg">about {formatGasCost(quote.estimatedCostWei)}</dd>
        </div>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-fg-muted">
          <dt>At most</dt>
          <dd>{formatGasCost(quote.maxCostWei)}</dd>
        </div>
        <div className="mt-3 flex flex-wrap justify-between gap-x-4 border-t border-border pt-3 text-xs text-fg-muted">
          <dt>Current base fee</dt>
          <dd>{formatGwei(quote.baseFeeWei)}</dd>
        </div>
        <div className="mt-1 flex flex-wrap justify-between gap-x-4 text-xs text-fg-muted">
          <dt>Tip for the block builder</dt>
          <dd>{formatGwei(quote.priorityFeeWei)}</dd>
        </div>
        <div className="mt-1 flex flex-wrap justify-between gap-x-4 text-xs text-fg-muted">
          <dt>Max fee per gas</dt>
          <dd>{formatGwei(quote.maxFeeWei)}</dd>
        </div>
        <div className="mt-1 flex flex-wrap justify-between gap-x-4 text-xs text-fg-muted">
          <dt>Gas limit</dt>
          <dd>{quote.gasLimit.toLocaleString("en-US")}</dd>
        </div>
        {quote.extraGas > 0 && (
          <div className="mt-1 flex flex-wrap justify-between gap-x-4 text-xs text-fg-muted">
            <dt>{extraLabel ?? "Second transaction"}</dt>
            <dd>{quote.extraGas.toLocaleString("en-US")} gas</dd>
          </div>
        )}
      </dl>
      <p className="mt-2 text-xs text-fg-muted">
        Paid from your node wallet to the Ethereum network, not to AVADO or Rocket Pool. It never costs more than &ldquo;at
        most&rdquo;: max fee per gas × {quote.extraGas > 0 ? "all the gas above" : "gas limit"}.
      </p>
    </div>
  );
}

const MINUTES = Math.round(DISMISS_AFTER_MS / 60_000);

function EntryNote({
  entry,
  noteRef,
  startedElsewhere,
  overdue,
  offChain,
}: {
  entry: PendingTx;
  noteRef: React.Ref<HTMLDivElement>;
  startedElsewhere: boolean;
  overdue: boolean;
  offChain?: OffChainSpec;
}) {
  const earlier = startedElsewhere && entry.state !== "done" && entry.state !== "failed" && (
    <p>This was started earlier. It can't be started again until it has finished.</p>
  );
  if (overdue) {
    return (
      <Note tone="warning" title="This transaction still isn't confirmed after an hour" noteRef={noteRef}>
        <p>
          It may be stuck (for example because network fees rose above its limit) or dropped by the network. Check it on Etherscan,
          a website that shows every Ethereum transaction.
        </p>
        <TxLink hash={entry.txHash} />
        <p>
          <strong>Keep waiting</strong> follows it for another hour. <strong>Stop tracking it</strong> only after Etherscan
          shows it was dropped or went through: if it is still pending and you start the same action again, both can go
          through.
        </p>
        {earlier}
      </Note>
    );
  }
  if (offChain && (entry.state === "sending" || entry.state === "unknown" || entry.state === "done")) {
    if (entry.state === "sending") {
      return (
        <Note tone="accent" title="Sending…" noteRef={noteRef}>
          <p className="flex items-center gap-2">
            <Spinner size="sm" label="Sending" /> {offChain.sendingText}
          </p>
          {earlier}
        </Note>
      );
    }
    if (entry.state === "done") {
      return (
        <Note tone="success" title={offChain.doneTitle} noteRef={noteRef}>
          {offChain.doneText}
        </Note>
      );
    }
    return (
      <Note tone="warning" title="We don't know if it was sent" noteRef={noteRef}>
        {entry.message && <p>{entry.message}</p>}
        <p>Don't try again yet: it may already be on its way.</p>
        <div>{offChain.checkText}</div>
        <p>After {MINUTES} minutes you can stop tracking it here.</p>
        {earlier}
      </Note>
    );
  }
  switch (entry.state) {
    case "sending":
      return (
        <Note tone="accent" title="Sending…" noteRef={noteRef}>
          <p className="flex items-center gap-2">
            <Spinner size="sm" label="Sending" /> Handing the transaction to your node. Please wait.
          </p>
          {earlier}
        </Note>
      );
    case "sent":
      return (
        <Note tone="accent" title="Sent. Waiting for the network to confirm it…" noteRef={noteRef}>
          <p className="flex items-center gap-2">
            <Spinner size="sm" label="Waiting" /> This usually takes under a minute. You can close this window; the
            transaction continues and this page keeps following it.
          </p>
          {earlier}
          <TxLink hash={entry.txHash} />
        </Note>
      );
    case "unknown":
      return (
        <Note tone="warning" title="We don't know if it was sent" noteRef={noteRef}>
          {entry.message && <p>{entry.message}</p>}
          <p>
            Don't try again yet: it may already be on its way. Check your node wallet's recent transactions on Etherscan (a website
            that shows every Ethereum transaction). After {MINUTES} minutes you can stop tracking it here.
          </p>
          {earlier}
        </Note>
      );
    case "lost":
      return (
        <Note tone="warning" title="Sent, but the result isn't known yet" noteRef={noteRef}>
          {entry.message && <p>{entry.message}</p>}
          <p>Don't send it again. Check it on Etherscan, or check again here.</p>
          {earlier}
          <TxLink hash={entry.txHash} />
        </Note>
      );
    case "done":
      return (
        <Note tone="success" title="Transaction confirmed" noteRef={noteRef}>
          <p>The network confirmed it. It went through.</p>
          <TxLink hash={entry.txHash} />
        </Note>
      );
    case "failed":
      return (
        <Note tone="danger" title="The transaction failed" noteRef={noteRef}>
          <p>The network processed it, but it did not go through, so nothing changed. The network fee for it was still paid. If you don't know why, contact AVADO support before trying again.</p>
          <TxLink hash={entry.txHash} />
        </Note>
      );
  }
}

export default TransactionFlow;
