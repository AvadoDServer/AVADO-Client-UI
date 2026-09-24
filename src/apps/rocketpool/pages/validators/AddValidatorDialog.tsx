import { useEffect, useState } from "react";
import { Button, Input, Modal, Spinner } from "../../../../components/ui";
import { plainError } from "../../api/errors";
import type { CanDepositResponse, MegapoolDetails } from "../../api/models";
import { useRocketpoolApi } from "../../api/RocketpoolApiProvider";
import { getBondRequirement } from "../../api/sn";
import { formatEth, toBigInt } from "../../lib/units";
import { TransactionFlow } from "../../tx/TransactionFlow";
import { Callout, Facts } from "../common";
import { bondForNewValidators } from "./model";

/** At most this many validators in one deposit from this screen. */
export const MAX_NEW_VALIDATORS = 10;

type Step =
  | { k: "choose" }
  | { k: "preparing" }
  | { k: "error"; message: string }
  | { k: "confirm"; count: number; tickets: number; total: bigint; useCredit: boolean };

/**
 * Add megapool validators: choose how many (and how many express tickets),
 * see the exact bond, then the usual check → fee → confirm transaction.
 * The bond is Smartnode's own calculation (see `bondForNewValidators`).
 */
export function AddValidatorDialog({
  megapool,
  expressTickets,
  nodeEth,
  credit,
  onClose,
  onDone,
}: {
  /** Undefined before the first validator: the megapool is created by the first deposit. */
  megapool: MegapoolDetails | undefined;
  expressTickets: number;
  nodeEth: bigint;
  credit: bigint;
  onClose: () => void;
  onDone: () => void;
}) {
  const api = useRocketpoolApi();
  const [countText, setCountText] = useState("1");
  const [ticketsText, setTicketsText] = useState(String(Math.min(1, expressTickets)));
  const [bond, setBond] = useState<{ count: number; perValidator: bigint[]; total: bigint } | { count: number; error: string } | null>(null);
  const [step, setStep] = useState<Step>({ k: "choose" });

  const count = /^\d+$/.test(countText) ? Number(countText) : NaN;
  const countOk = Number.isInteger(count) && count >= 1 && count <= MAX_NEW_VALIDATORS;
  const tickets = /^\d+$/.test(ticketsText) ? Number(ticketsText) : NaN;
  const ticketsOk = Number.isInteger(tickets) && tickets >= 0 && tickets <= Math.min(expressTickets, countOk ? count : expressTickets);

  const active = megapool?.activeValidatorCount ?? 0;
  const nodeBond = toBigInt(megapool?.nodeBond) ?? 0n;
  const queuedBond = toBigInt(megapool?.nodeQueuedBond) ?? 0n;

  // The bond for this many validators: one requirement read per validator.
  useEffect(() => {
    if (!countOk) return;
    let cancelled = false;
    setBond(null);
    Promise.all(Array.from({ length: count }, (_, i) => getBondRequirement(api, active + i + 1)))
      .then((answers) => {
        if (cancelled) return;
        const reqs = answers.map((a) => toBigInt(a.bondRequirement));
        if (reqs.some((r) => r === null)) throw new Error("Rocket Pool returned no bond requirement.");
        setBond({ count, ...bondForNewValidators(nodeBond, queuedBond, reqs as bigint[]) });
      })
      .catch((e) => {
        if (!cancelled) setBond({ count, error: plainError(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [api, count, countOk, active, nodeBond, queuedBond]);

  const ready = countOk && ticketsOk && bond !== null && "total" in bond && bond.count === count;

  const review = async () => {
    if (!ready || !("total" in bond!)) return;
    setStep({ k: "preparing" });
    try {
      // Whether credit can pay part of it decides the request, so ask first; the flow checks everything again.
      const can = await api.snGet<CanDepositResponse>("node/can-deposit", {
        amountWei: bond!.total.toString(),
        minFee: "0",
        salt: "0",
        expressTickets: tickets,
        count,
      });
      setStep({ k: "confirm", count, tickets, total: bond!.total, useCredit: can.canUseCredit === true });
    } catch (e) {
      setStep({ k: "error", message: plainError(e) });
    }
  };

  if (step.k === "confirm") {
    const { total, useCredit } = step;
    return (
      <TransactionFlow<CanDepositResponse>
        open
        title={step.count === 1 ? "Add a validator" : `Add ${step.count} validators`}
        summary={
          <div className="flex flex-col gap-2">
            <p>
              Deposits a bond of <strong>{formatEth(total)}</strong> into your megapool
              {useCredit ? " (your credit is used first, the rest comes from the node wallet)" : " from your node wallet"}. Rocket
              Pool adds the rest of each validator's 32 ETH.
            </p>
            <p>
              The new validators wait in Rocket Pool's queue{step.tickets > 0 ? ` (${step.tickets} with an express ticket)` : ""}; your
              node starts them automatically. The bond stays in Rocket Pool until you exit them.
            </p>
          </div>
        }
        tx={{
          canRoute: "node/can-deposit",
          route: "node/deposit",
          params: {
            amountWei: total.toString(),
            minFee: "0",
            salt: "0",
            expressTickets: step.tickets,
            count: step.count,
            useCreditBalance: useCredit ? "true" : "false",
            submit: "true",
          },
          blockedReason: (can) => {
            if (can.canDeposit !== true) {
              if (can.nodeHasDebt) return "Your megapool has a debt. Repay it first.";
              if (can.depositDisabled) return "Rocket Pool isn't taking new deposits right now.";
              if (can.insufficientBalance || can.insufficientBalanceWithoutCredit) {
                return `The node wallet doesn't have enough ETH for this. It needs ${formatEth(total)} plus the network fee.`;
              }
              if (can.invalidAmount) return "This amount isn't allowed.";
              return "Rocket Pool says this can't be done right now.";
            }
            if (useCredit && can.canUseCredit === false) return "Your credit can't be used right now. Close this and review again.";
            return null;
          },
          details: (can) => (
            <Facts
              items={[
                { label: "Bond", value: formatEth(total) },
                { label: "Node wallet", value: formatEth(can.nodeBalance) },
                ...(useCredit ? [{ label: "Credit", value: formatEth(can.creditBalance) }] : []),
              ]}
            />
          ),
        }}
        confirmLabel="Deposit"
        onClose={onClose}
        onDone={() => {
          // The new keys must be loaded into the consensus client: ask the key check to run now.
          void api.requestReconcile().catch(() => undefined);
          onDone();
        }}
      />
    );
  }

  const busy = step.k === "preparing";
  const total = bond && "total" in bond && bond.count === count ? bond.total : null;
  const short = total !== null && total > nodeEth + credit;

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      closeOnBackdrop={!busy}
      title="Add validators"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={review} disabled={!ready || busy} loading={busy}>
            Review
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-fg-muted">
          Each megapool validator needs a bond from you; Rocket Pool adds the rest of its 32 ETH. RPL is optional.
        </p>
        <Input
          label="How many validators"
          inputMode="numeric"
          value={countText}
          onChange={(e) => setCountText(e.target.value.trim())}
          error={countText !== "" && !countOk ? `Enter a number from 1 to ${MAX_NEW_VALIDATORS}.` : undefined}
        />
        {expressTickets > 0 && (
          <Input
            label="Express tickets to use"
            inputMode="numeric"
            value={ticketsText}
            onChange={(e) => setTicketsText(e.target.value.trim())}
            hint={`You have ${expressTickets}. A validator with a ticket skips ahead in the queue.`}
            error={ticketsText !== "" && !ticketsOk ? `Enter a number from 0 to ${Math.min(expressTickets, countOk ? count : expressTickets)}.` : undefined}
          />
        )}
        {countOk && bond === null && (
          <p className="flex items-center gap-2 text-fg-muted">
            <Spinner size="sm" label="Working out the bond" /> Working out the bond…
          </p>
        )}
        {bond && "error" in bond && (
          <Callout tone="danger" title="Could not work out the bond" role="alert">
            <p>{bond.error}</p>
          </Callout>
        )}
        {total !== null && (
          <Facts
            items={[
              { label: "Bond to deposit", value: formatEth(total) },
              { label: "Node wallet", value: formatEth(nodeEth), hint: credit > 0n ? `plus ${formatEth(credit)} credit` : undefined },
            ]}
          />
        )}
        {short && (
          <Callout tone="warning" title="Not enough ETH yet">
            <p>Send more ETH to the node wallet first. It also needs a little extra for the network fee.</p>
          </Callout>
        )}
        {step.k === "error" && (
          <Callout tone="danger" title="Could not check the deposit" role="alert">
            <p>{step.message}</p>
          </Callout>
        )}
      </div>
    </Modal>
  );
}
