/**
 * New megapool validators: the one deposit component, used by the setup
 * wizard's last step and by "Add a validator" on the Validators page.
 *
 *  - `NewValidatorsForm`: how many, express tickets, the exact bond
 *    (Smartnode CLI rule, `lib/bond.ts`), how it is paid (credit per
 *    Smartnode's `nodeDeposits`), and `node/can-deposit`'s answer. The reads
 *    wait `PLAN_DEBOUNCE_MS` after the last change; a newer change aborts
 *    the older reads.
 *  - `DepositFlow`: `node/can-deposit` → `node/deposit` with `submit=true`
 *    through TransactionFlow, with one fixed parameter set, so the
 *    pending-transaction lock is the route alone (`node/deposit`). After it
 *    succeeds the key check is asked to run, so the new keys get loaded.
 */
import { useEffect, useMemo, useState } from "react";
import { Button, Input, Spinner } from "../../../../components/ui";
import { ADMIN_STORE_URL } from "../../../../components/shell/links";
import { plainError } from "../../api/errors";
import type { BondRequirementResponse, CanDepositResponse, MegapoolDetails, NodeStatus } from "../../api/models";
import { reconcileStatusOf } from "../../api/reconcile";
import { useRocketpoolApi } from "../../api/RocketpoolApiProvider";
import type { SnParams } from "../../api/types";
import { ExternalLink, Facts, Notice } from "../../components/common";
import { useNodeSync } from "../../data/nodeReads";
import { MAX_DEPOSIT_COUNT, newValidatorBonds, sumWei } from "../../lib/bond";
import { formatEth, toBigInt } from "../../lib/units";
import { useAppStatus } from "../../status/AppStatus";
import { TransactionFlow, defaultBlockedReason } from "../../tx/TransactionFlow";

export const DEPOSIT_ROUTE = "node/deposit";
export const CAN_DEPOSIT_ROUTE = "node/can-deposit";

/**
 * The one parameter set for `node/can-deposit` and `node/deposit` (the
 * check ignores the last two). Always the same keys: the deposit has no
 * target, so its pending-transaction lock is the route alone.
 */
export function depositParams(o: { count: number; bondWei: bigint; expressTickets: number; useCredit: boolean }): SnParams {
  return {
    amountWei: o.bondWei.toString(),
    minFee: "0",
    salt: "0",
    expressTickets: String(o.expressTickets),
    count: String(o.count),
    useCreditBalance: o.useCredit ? "true" : "false",
    submit: "true",
  };
}

/** Wait this long after the last change before working out the bond (ms). */
export const PLAN_DEBOUNCE_MS = 400;

export interface CreditPlan {
  useCredit: boolean;
  fromCredit: bigint;
  fromWallet: bigint;
  /** Why the credit isn't used although there is some. */
  note: string | null;
  /** Why the deposit can't go ahead with this split. */
  blocked: string | null;
}

/**
 * How the bond is paid, the way Smartnode's `nodeDeposits` does it: with
 * `useCreditBalance`, it sends bond − the **full** credit balance. So credit is
 * only used when all of it is usable now (the deposit pool can take it);
 * otherwise the whole bond comes from the node wallet.
 */
export function creditPlan(can: CanDepositResponse, bondWei: bigint): CreditPlan {
  const credit = toBigInt(can.creditBalance) ?? 0n;
  const usable = toBigInt(can.usableCreditBalance) ?? 0n;
  const wallet = toBigInt(can.nodeBalance) ?? 0n;
  if (can.canUseCredit && credit > 0n && credit <= usable) {
    const fromCredit = credit < bondWei ? credit : bondWei;
    return { useCredit: true, fromCredit, fromWallet: bondWei - fromCredit, note: null, blocked: null };
  }
  const note =
    credit > 0n
      ? "Your credit can't all be used right now (Rocket Pool's deposit pool is low), so the whole bond is paid from the node wallet."
      : null;
  const blocked =
    credit > 0n && wallet < bondWei
      ? `The node wallet has ${formatEth(wallet)}, not enough for the whole bond, and your credit can't be used right now. Add ETH or try again later.`
      : null;
  return { useCredit: false, fromCredit: 0n, fromWallet: bondWei, note, blocked };
}

/** Why the deposit can't be made, from `can-deposit` (null when it can). A missing `canDeposit` blocks. */
export function blockedReasonFor(can: CanDepositResponse): string | null {
  if (can.canDeposit === true) return null;
  if (can.nodeHasDebt) return "Your megapool has a debt. Repay it first (Validators page).";
  if (can.insufficientBalanceWithoutCredit) {
    return "Your credit can't be used right now because Rocket Pool's deposit pool is low, and the node wallet alone doesn't have enough ETH. Add ETH or try again later.";
  }
  if (can.insufficientBalance) {
    return `The node wallet doesn't have enough ETH for this bond: it has ${formatEth(can.nodeBalance)}. Add ETH first.`;
  }
  return defaultBlockedReason({ ...can, canDeposit: false }, CAN_DEPOSIT_ROUTE);
}

/** A checked deposit, ready for the transaction flow. */
export interface DepositPlan {
  count: number;
  bondWei: bigint;
  perValidator: bigint[];
  expressTickets: number;
  useCredit: boolean;
  fromCredit: bigint;
  fromWallet: bigint;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface Checked {
  count: number;
  expressTickets: number;
  bondWei: bigint;
  perValidator: bigint[];
  can: CanDepositResponse;
}

/**
 * Choose the new validators and see what they cost. `onReview` gets the
 * checked plan; the caller opens `DepositFlow` with it.
 */
export function NewValidatorsForm({
  node,
  megapool,
  onReview,
}: {
  node: NodeStatus;
  /** undefined while it loads; null when the node has no megapool yet (the first deposit creates it). */
  megapool: MegapoolDetails | null | undefined;
  onReview: (plan: DepositPlan) => void;
}) {
  const api = useRocketpoolApi();
  const { reconcile } = useAppStatus();
  const sync = useNodeSync(!!node.registered);
  const [countText, setCountText] = useState("1");
  const [ticketsText, setTicketsText] = useState<string | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);

  const tickets = megapool?.nodeExpressTicketCount ?? node.expressTicketCount ?? 0;
  const count = /^\d+$/.test(countText.trim()) ? Number(countText.trim()) : NaN;
  const countOk = Number.isInteger(count) && count >= 1 && count <= MAX_DEPOSIT_COUNT;
  const maxTickets = countOk ? Math.min(count, tickets) : 0;
  const useTickets = ticketsText === null ? maxTickets : /^\d+$/.test(ticketsText.trim()) ? Number(ticketsText.trim()) : NaN;
  const ticketsOk = Number.isInteger(useTickets) && useTickets >= 0 && useTickets <= maxTickets;

  const client = reconcileStatusOf(reconcile)?.client ?? null;
  const reconcileKnown = !!reconcileStatusOf(reconcile);
  const synced = sync.data ? sync.data.ecStatus.primaryEcStatus.isSynced && sync.data.bcStatus.primaryEcStatus.isSynced : null;

  // What is bonded already (null while the megapool is still loading).
  const bonded = useMemo(() => {
    if (megapool === undefined) return null;
    if (megapool === null) return 0n;
    return (toBigInt(megapool.nodeBond) ?? 0n) + (toBigInt(megapool.nodeQueuedBond) ?? 0n);
  }, [megapool]);
  const active = megapool?.activeValidatorCount ?? 0;

  // The bond for this many validators (Smartnode's rule), then what Rocket Pool says about the deposit.
  useEffect(() => {
    if (!countOk || !ticketsOk || bonded === null) {
      setChecked(null);
      return;
    }
    let cancelled = false;
    const abort = new AbortController();
    const opts = { signal: abort.signal };
    setPlanning(true);
    setPlanError(null);
    // Wait until the owner stops typing; a newer change cancels the old reads.
    const wait = new Promise<void>((resolve) => setTimeout(resolve, PLAN_DEBOUNCE_MS));
    (async () => {
      await wait;
      if (cancelled) throw new Error("cancelled");
      const reqs = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          api.snGet<BondRequirementResponse>("node/get-bond-requirement", { numValidators: active + i + 1 }, opts).then((r) => {
            const v = toBigInt(r.bondRequirement);
            if (v === null) throw new Error("Rocket Pool returned no bond requirement.");
            return v;
          }),
        ),
      );
      const perValidator = newValidatorBonds(reqs, bonded);
      const bondWei = sumWei(perValidator);
      const can = await api.snGet<CanDepositResponse>(
        CAN_DEPOSIT_ROUTE,
        depositParams({ count, bondWei, expressTickets: useTickets, useCredit: false }),
        opts,
      );
      return { count, expressTickets: useTickets, bondWei, perValidator, can };
    })()
      .then((p) => {
        if (!cancelled) setChecked(p);
      })
      .catch((e) => {
        if (!cancelled) {
          setChecked(null);
          setPlanError(plainError(e));
        }
      })
      .finally(() => {
        if (!cancelled) setPlanning(false);
      });
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [api, count, countOk, useTickets, ticketsOk, bonded, active]);

  const split = checked ? creditPlan(checked.can, checked.bondWei) : null;
  const useCredit = !!split?.useCredit;
  const fromWallet = split?.fromWallet ?? 0n;
  const precheck = checked ? (blockedReasonFor(checked.can) ?? split?.blocked ?? null) : null;
  const noClient = reconcileKnown && !client;
  const notSynced = synced === false;
  const canStart = !!checked && !!split && !precheck && !noClient && !notSynced && !planning;

  return (
    <div className="flex flex-col gap-5">
      {noClient && (
        <Notice tone="danger" title="Install a consensus client first">
          <p>Your validators need a consensus client (Nimbus, Teku, Lighthouse or Prysm) on this AVADO to run.</p>
          <ExternalLink href={ADMIN_STORE_URL}>Open the DappStore</ExternalLink>
        </Notice>
      )}
      {notSynced && (
        <Notice tone="warning" title="Wait until your Ethereum clients are in sync">
          <p>Your execution and consensus clients must be fully synced before you create validators.</p>
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="How many validators"
          inputMode="numeric"
          value={countText}
          onChange={(e) => setCountText(e.target.value)}
          error={countText.trim() && !countOk ? `Choose 1 to ${MAX_DEPOSIT_COUNT}.` : undefined}
          hint="You can add more later."
          autoComplete="off"
        />
        {tickets > 0 && (
          <Input
            label="Express tickets to use"
            inputMode="numeric"
            value={ticketsText ?? String(maxTickets)}
            onChange={(e) => setTicketsText(e.target.value)}
            error={!ticketsOk ? `Choose 0 to ${maxTickets}.` : undefined}
            hint={`You have ${plural(tickets, "express ticket")}. Each one puts a validator in the faster queue.`}
            autoComplete="off"
          />
        )}
      </div>

      {(planning || (bonded === null && countOk)) && (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <Spinner size="sm" label="Checking" /> Working out the bond…
        </p>
      )}
      {planError && (
        <Notice tone="danger" title="Could not check the deposit" live>
          <p>{planError}</p>
        </Notice>
      )}
      {checked && !planning && (
        <Facts
          testId="deposit-plan"
          rows={[
            ["Validators", String(checked.count)],
            ["Your bond", formatEth(checked.bondWei)],
            ...(useCredit ? ([["Paid from your credit", formatEth(split!.fromCredit)]] as Array<[string, string]>) : []),
            ["Paid from the node wallet", `${formatEth(fromWallet)} + network fee`],
            ["In the node wallet now", formatEth(checked.can.nodeBalance)],
            ...(tickets > 0 ? ([["Express tickets used", String(checked.expressTickets)]] as Array<[string, string]>) : []),
          ]}
        />
      )}
      {split?.note && !precheck && (
        <Notice tone="neutral">
          <p>{split.note}</p>
        </Notice>
      )}
      {precheck && (
        <Notice tone="warning" title="Not possible right now" live>
          <p>{precheck}</p>
        </Notice>
      )}

      <div>
        <Button
          variant="primary"
          disabled={!canStart}
          onClick={() => {
            if (!checked || !split || !canStart) return;
            onReview({
              count: checked.count,
              bondWei: checked.bondWei,
              perValidator: checked.perValidator,
              expressTickets: checked.expressTickets,
              useCredit: split.useCredit,
              fromCredit: split.fromCredit,
              fromWallet: split.fromWallet,
            });
          }}
        >
          {countOk ? `Create ${plural(count, "validator")}` : "Create validators"}
        </Button>
      </div>
    </div>
  );
}

/** The deposit itself: check → fee → confirm, then the key check is asked to run. */
export function DepositFlow({
  plan,
  open,
  onClose,
  onDone,
}: {
  plan: DepositPlan;
  open: boolean;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const api = useRocketpoolApi();
  return (
    <TransactionFlow<CanDepositResponse>
      open={open}
      title={`Create ${plural(plan.count, "validator")}`}
      summary={
        <>
          Makes {plural(plan.count, "new validator key")} on this AVADO and deposits your bond of{" "}
          <strong className="text-fg">{formatEth(plan.bondWei)}</strong>
          {plan.useCredit ? ` (${formatEth(plan.fromCredit)} of it from your credit)` : ""}. Rocket Pool adds the rest of each
          validator's 32 ETH. The {plan.count === 1 ? "validator joins" : "validators join"} Rocket Pool's queue
          {plan.expressTickets > 0 ? ` (${plan.expressTickets} with an express ticket)` : ""}; your node starts{" "}
          {plan.count === 1 ? "it" : "them"} automatically. You can leave the queue later and get the bond back as credit. The network
          fee below is paid from the node wallet on top of the bond.
        </>
      }
      tx={{
        canRoute: CAN_DEPOSIT_ROUTE,
        route: DEPOSIT_ROUTE,
        params: depositParams({ count: plan.count, bondWei: plan.bondWei, expressTickets: plan.expressTickets, useCredit: plan.useCredit }),
        blockedReason: (can) => {
          const now = creditPlan(can, plan.bondWei);
          if (now.useCredit !== plan.useCredit || now.fromWallet !== plan.fromWallet) {
            return "Your credit balance changed since the last check. Close this and try again.";
          }
          return blockedReasonFor(can) ?? now.blocked;
        },
        details: (can) => (
          <Facts
            rows={[
              ["Validators", String(plan.count)],
              ["Bond", formatEth(plan.bondWei)],
              ...(plan.useCredit ? ([["From your credit", formatEth(plan.fromCredit)]] as Array<[string, string]>) : []),
              ["From the node wallet", `${formatEth(plan.fromWallet)} + network fee`],
              ["In the node wallet", formatEth(can.nodeBalance)],
            ]}
          />
        ),
      }}
      confirmLabel="Create validators"
      onClose={onClose}
      onDone={() => {
        // The new keys must be loaded into the consensus client: ask the key check to run now.
        void api.requestReconcile().catch(() => undefined);
        onDone(plan.count);
      }}
    />
  );
}
