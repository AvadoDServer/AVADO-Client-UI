import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Input, Modal, Spinner, StatusDot, cn } from "../../../components/ui";
import { isOutcomeUnknown, isTxReverted, plainError } from "../api/errors";
import type { CanResponse, GasLimits, SnEnvelope, TxResponse } from "../api/models";
import { useRocketpoolApi } from "../api/RocketpoolApiProvider";
import { getGasPrice, waitForTx } from "../api/sn";
import type { SnParams } from "../api/types";
import { isTxHash, txUrl } from "../lib/explorer";
import { formatGasCost, formatGwei } from "../lib/units";
import { gasParams, quoteGas, type GasQuote } from "./gas";

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
   * when it can. Default: any `canX: false` flag in the answer blocks it.
   */
  blockedReason?: (can: C) => string | null;
  /** Extra summary lines from the check's answer (amounts, addresses). */
  details?: (can: C) => ReactNode;
  /** Where the answer holds the gas limits (default `gasLimits`). */
  gasLimits?: (can: C) => GasLimits | undefined;
  /** The write answer's field with the tx hash (default `txHash`). */
  txHashField?: string;
}

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
  /**
   * Confirm stays disabled this long after the summary shows (ms), so the
   * second click of a double click that opened the dialog can't confirm.
   */
  armDelayMs?: number;
  onClose: () => void;
  /** The transaction was mined and succeeded. */
  onDone?: (txHash: string) => void;
}

export const DEFAULT_ARM_DELAY_MS = 800;

type Phase<C> =
  | { k: "checking" }
  | { k: "check-error"; message: string }
  | { k: "blocked"; reason: string }
  | { k: "ready"; can: C; quote: GasQuote }
  | { k: "sending"; can: C; quote: GasQuote }
  /** The write was refused: nothing was sent. */
  | { k: "send-failed"; message: string }
  /** No clear answer to the write: it may or may not have been sent. */
  | { k: "send-unknown"; message: string }
  | { k: "waiting"; txHash: string }
  /** Sent, but we couldn't learn the outcome. */
  | { k: "wait-unknown"; txHash: string; message: string }
  | { k: "done"; txHash: string }
  /** Mined, but it failed. */
  | { k: "failed"; txHash: string; message: string };

/** Default rule: an answer with any `canX: false` flag (e.g. `canDistribute`) can't go ahead. */
export function defaultBlockedReason(can: CanResponse): string | null {
  const refused = Object.entries(can).some(([k, v]) => /^can[A-Z]/.test(k) && v === false);
  return refused ? "Rocket Pool says this can't be done right now." : null;
}

function TxLink({ hash }: { hash: string }) {
  const href = txUrl(hash);
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

function Note({ tone, title, children }: { tone: "danger" | "warning" | "success" | "accent"; title: string; children?: ReactNode }) {
  const box = {
    danger: "border-danger/25 bg-danger-subtle",
    warning: "border-warning/25 bg-warning-subtle",
    success: "border-success/25 bg-success-subtle",
    accent: "border-accent/25 bg-accent-subtle",
  }[tone];
  return (
    <div role={tone === "danger" || tone === "warning" ? "alert" : "status"} className={cn("mt-4 flex gap-3 rounded-xl border p-4", box)}>
      <StatusDot tone={tone} className="mt-1.5" />
      <div className="min-w-0 text-sm text-fg">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-1 flex flex-col gap-2 break-words">{children}</div>}
      </div>
    </div>
  );
}

/**
 * The one way the app sends a transaction:
 * check (`can-X` + gas price) → plain summary and fee → explicit confirm →
 * send (`X`) → wait until mined → done or failed, with an explorer link.
 *
 * Accidental sends are made impossible: nothing is sent without a click on
 * the confirm button, which only exists once the check passed and the fee
 * is known, is disabled for `armDelayMs` after it appears, and works once
 * per dialog (a synchronous guard, not only the disabled state). A send with
 * an unclear outcome is never offered again from here.
 */
export function TransactionFlow<C extends CanResponse = CanResponse>({
  open,
  title,
  summary,
  tx,
  confirmLabel,
  tone = "primary",
  requireText,
  armDelayMs = DEFAULT_ARM_DELAY_MS,
  onClose,
  onDone,
}: TransactionFlowProps<C>) {
  const api = useRocketpoolApi();
  const [phase, setPhase] = useState<Phase<C>>({ k: "checking" });
  const [armed, setArmed] = useState(false);
  const [typed, setTyped] = useState("");
  /** Bumped on every (re)start and on close: late answers of an older run are ignored. */
  const run = useRef(0);
  /** Set the moment the write is fired; only a definite refusal clears it. */
  const sent = useRef(false);

  const txRef = useRef(tx);
  txRef.current = tx;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const check = useCallback(async () => {
    const id = ++run.current;
    sent.current = false;
    setArmed(false);
    setPhase({ k: "checking" });
    const spec = txRef.current;
    try {
      const [can, gas] = await Promise.all([api.snGet<C>(spec.canRoute, spec.params), getGasPrice(api)]);
      if (id !== run.current) return;
      const reason = (spec.blockedReason ?? defaultBlockedReason)(can);
      if (reason) return setPhase({ k: "blocked", reason });
      const quote = quoteGas(spec.gasLimits ? spec.gasLimits(can) : can.gasLimits, gas.gasPrice);
      if (!quote) {
        return setPhase({
          k: "blocked",
          reason: "The network fee could not be estimated, so nothing can be sent right now. Try again in a few minutes.",
        });
      }
      setPhase({ k: "ready", can, quote });
    } catch (e) {
      if (id === run.current) setPhase({ k: "check-error", message: plainError(e) });
    }
  }, [api]);

  const follow = useCallback(
    async (txHash: string, id: number) => {
      setPhase({ k: "waiting", txHash });
      try {
        await waitForTx(api, txHash);
        if (id !== run.current) return;
        setPhase({ k: "done", txHash });
        onDoneRef.current?.(txHash);
      } catch (e) {
        if (id !== run.current) return;
        if (isTxReverted(e)) setPhase({ k: "failed", txHash, message: plainError(e) });
        else setPhase({ k: "wait-unknown", txHash, message: plainError(e) });
      }
    },
    [api],
  );

  // A fresh check every time the dialog opens, unless an earlier send from
  // this dialog is still unresolved: then it shows that one again (and keeps
  // following its hash) instead of offering a second send. Closing forgets
  // the run, not the unresolved send.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    if (open) {
      setTyped("");
      const last = phaseRef.current;
      if (last.k === "send-unknown") return;
      if (last.k === "waiting" || last.k === "wait-unknown") void follow(last.txHash, ++run.current);
      else void check();
    }
    return () => {
      run.current += 1;
    };
  }, [open, check, follow]);

  // Confirm works only after the summary has been on screen for a moment.
  const readyKey = phase.k === "ready" ? phase.quote : null;
  useEffect(() => {
    if (!readyKey) return;
    setArmed(armDelayMs <= 0);
    if (armDelayMs <= 0) return;
    const t = setTimeout(() => setArmed(true), armDelayMs);
    return () => clearTimeout(t);
  }, [readyKey, armDelayMs]);

  const confirm = async () => {
    if (phase.k !== "ready" || !armed || sent.current) return;
    if (requireText !== undefined && typed.trim() !== requireText) return;
    sent.current = true; // before any await: a second click can't get past this
    const id = run.current;
    const { can, quote } = phase;
    setPhase({ k: "sending", can, quote });
    const spec = txRef.current;
    let res: TxResponse;
    try {
      res = await api.snPost<TxResponse & SnEnvelope>(spec.route, { ...(spec.params ?? {}), ...gasParams(quote) });
    } catch (e) {
      if (id !== run.current) return;
      if (isOutcomeUnknown(e)) setPhase({ k: "send-unknown", message: plainError(e) });
      else setPhase({ k: "send-failed", message: plainError(e) });
      return;
    }
    if (id !== run.current) return;
    const hash = res[spec.txHashField ?? "txHash"];
    if (!isTxHash(hash)) {
      setPhase({ k: "send-unknown", message: "Rocket Pool accepted the request but did not return a transaction hash." });
      return;
    }
    void follow(hash, id);
  };

  const recheckWait = () => {
    if (phase.k === "wait-unknown") void follow(phase.txHash, ++run.current);
  };

  const sending = phase.k === "sending";
  const close = sending ? undefined : onClose;
  const typedOk = requireText === undefined || typed.trim() === requireText;

  let footer: ReactNode;
  switch (phase.k) {
    case "ready":
    case "sending":
      footer = (
        <>
          <Button variant="secondary" pill onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button variant={tone} pill onClick={confirm} loading={sending} disabled={!armed || !typedOk}>
            {confirmLabel}
          </Button>
        </>
      );
      break;
    case "check-error":
    case "send-failed":
      footer = (
        <>
          <Button variant="secondary" pill onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" pill onClick={() => void check()}>
            Check again
          </Button>
        </>
      );
      break;
    case "wait-unknown":
      footer = (
        <>
          <Button variant="secondary" pill onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" pill onClick={recheckWait}>
            Check the transaction again
          </Button>
        </>
      );
      break;
    default:
      footer = (
        <Button variant={phase.k === "done" ? "primary" : "secondary"} pill onClick={onClose}>
          {phase.k === "done" ? "Done" : phase.k === "checking" ? "Cancel" : "Close"}
        </Button>
      );
  }

  return (
    <Modal open={open} onClose={close} title={title} size="md" closeOnBackdrop={!sending} footer={footer}>
      <div className="text-sm text-fg-muted">{summary}</div>

      {phase.k === "checking" && (
        <p className="mt-4 flex items-center gap-2 text-sm text-fg-muted">
          <Spinner size="sm" label="Checking" /> Checking with Rocket Pool and estimating the network fee…
        </p>
      )}

      {phase.k === "check-error" && <Note tone="danger" title="Could not check this transaction">{phase.message}</Note>}

      {phase.k === "blocked" && (
        <Note tone="warning" title="This can't be done right now">
          {phase.reason}
        </Note>
      )}

      {(phase.k === "ready" || phase.k === "sending") && (
        <>
          {tx.details && <div className="mt-4 text-sm text-fg">{tx.details(phase.can)}</div>}
          <dl className="mt-4 rounded-xl border border-border bg-surface p-4 text-sm" data-testid="tx-fee">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <dt className="font-medium text-fg">Network fee</dt>
              <dd className="font-semibold text-fg">about {formatGasCost(phase.quote.estimatedCostWei)}</dd>
            </div>
            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-fg-muted">
              <dt>At most</dt>
              <dd>{formatGasCost(phase.quote.maxCostWei)}</dd>
            </div>
            <p className="mt-2 text-xs text-fg-muted">
              Paid from your node wallet to the Ethereum network, not to AVADO or Rocket Pool. Current base fee{" "}
              {formatGwei(phase.quote.baseFeeWei)} plus a {formatGwei(phase.quote.priorityFeeWei)} tip.
            </p>
          </dl>
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
              disabled={sending}
            />
          )}
          <p className="mt-4 text-xs text-fg-muted">
            {sending ? "Sending…" : `Nothing is sent until you press ${confirmLabel}.`}
          </p>
        </>
      )}

      {phase.k === "send-failed" && (
        <Note tone="danger" title="Not sent">
          <p>{phase.message}</p>
          <p>Nothing was sent and no fee was paid.</p>
        </Note>
      )}

      {phase.k === "send-unknown" && (
        <Note tone="warning" title="We don't know if it was sent">
          <p>{phase.message}</p>
          <p>
            Don't try again yet: it may already be on its way. Wait a few minutes, then check your node wallet's recent
            transactions on Etherscan before doing anything else.
          </p>
        </Note>
      )}

      {phase.k === "waiting" && (
        <Note tone="accent" title="Sent. Waiting for it to be included in a block…">
          <p className="flex items-center gap-2">
            <Spinner size="sm" label="Waiting" /> This usually takes under a minute. You can close this window; the
            transaction continues.
          </p>
          <TxLink hash={phase.txHash} />
        </Note>
      )}

      {phase.k === "wait-unknown" && (
        <Note tone="warning" title="Sent, but the result isn't known yet">
          <p>{phase.message}</p>
          <p>Don't send it again. Check it on Etherscan, or check again here.</p>
          <TxLink hash={phase.txHash} />
        </Note>
      )}

      {phase.k === "done" && (
        <Note tone="success" title="Transaction confirmed">
          <p>It is included in a block and went through.</p>
          <TxLink hash={phase.txHash} />
        </Note>
      )}

      {phase.k === "failed" && (
        <Note tone="danger" title="The transaction failed">
          <p>It was included in a block but did not go through. The network fee for it was still paid.</p>
          <TxLink hash={phase.txHash} />
        </Note>
      )}
    </Modal>
  );
}

export default TransactionFlow;
