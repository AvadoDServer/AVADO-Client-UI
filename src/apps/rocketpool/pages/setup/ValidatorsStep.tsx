import { useEffect, useMemo, useState } from "react";
import { Button, Input, Spinner } from "../../../../components/ui";
import { ADMIN_STORE_URL } from "../../../../components/shell/links";
import { plainError } from "../../api/errors";
import type { BondRequirementResponse, CanDepositResponse, NodeStatus } from "../../api/models";
import { reconcileStatusOf } from "../../api/reconcile";
import { useRocketpoolApi } from "../../api/RocketpoolApiProvider";
import type { SnParams } from "../../api/types";
import { AutoTxNotice, ExternalLink, Facts, Notice } from "../../components/common";
import { useMegapoolStatus, useNodeSync } from "../../data/nodeReads";
import { MAX_DEPOSIT_COUNT, newValidatorBonds, sumWei } from "../../lib/bond";
import { formatEth, toBigInt } from "../../lib/units";
import { useAppStatus } from "../../status/AppStatus";
import { TransactionFlow, defaultBlockedReason } from "../../tx/TransactionFlow";

const DEPOSIT_ROUTE = "node/deposit";
const CAN_DEPOSIT_ROUTE = "node/can-deposit";

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

interface Plan {
  count: number;
  bondWei: bigint;
  perValidator: bigint[];
  can: CanDepositResponse;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Step 6: the first megapool validators (`node/can-deposit` → `node/deposit` with `submit=true`). */
export function ValidatorsStep({ node, onChanged }: { node?: NodeStatus; onChanged: () => void }) {
  const api = useRocketpoolApi();
  const { reconcile } = useAppStatus();
  const registered = !!node?.registered;
  const mega = useMegapoolStatus(registered);
  const sync = useNodeSync(registered);
  const [countText, setCountText] = useState("1");
  const [ticketsText, setTicketsText] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<number | null>(null);

  const details = mega.data?.megapoolDetails;
  const tickets = details?.nodeExpressTicketCount ?? node?.expressTicketCount ?? 0;
  const count = /^\d+$/.test(countText.trim()) ? Number(countText.trim()) : NaN;
  const countOk = Number.isInteger(count) && count >= 1 && count <= MAX_DEPOSIT_COUNT;
  const maxTickets = countOk ? Math.min(count, tickets) : 0;
  const useTickets = ticketsText === null ? maxTickets : /^\d+$/.test(ticketsText.trim()) ? Number(ticketsText.trim()) : NaN;
  const ticketsOk = Number.isInteger(useTickets) && useTickets >= 0 && useTickets <= maxTickets;

  const client = reconcileStatusOf(reconcile)?.client ?? null;
  const reconcileKnown = !!reconcileStatusOf(reconcile);
  const synced = sync.data ? sync.data.ecStatus.primaryEcStatus.isSynced && sync.data.bcStatus.primaryEcStatus.isSynced : null;

  // The bond for this many validators (Smartnode's rule), then what Rocket Pool says about the deposit.
  const bonded = useMemo(() => {
    if (!details) return null;
    return (toBigInt(details.nodeBond) ?? 0n) + (toBigInt(details.nodeQueuedBond) ?? 0n);
  }, [details]);
  const active = details?.activeValidatorCount ?? 0;
  useEffect(() => {
    if (!countOk || !ticketsOk || bonded === null) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    setPlanning(true);
    setPlanError(null);
    (async () => {
      const reqs = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          api.snGet<BondRequirementResponse>("node/get-bond-requirement", { numValidators: active + i + 1 }).then((r) => {
            const v = toBigInt(r.bondRequirement);
            if (v === null) throw new Error("bad bond requirement");
            return v;
          }),
        ),
      );
      const perValidator = newValidatorBonds(reqs, bonded);
      const bondWei = sumWei(perValidator);
      const can = await api.snGet<CanDepositResponse>(
        CAN_DEPOSIT_ROUTE,
        depositParams({ count, bondWei, expressTickets: useTickets, useCredit: false }),
      );
      return { count, bondWei, perValidator, can };
    })()
      .then((p) => {
        if (!cancelled) setPlan(p);
      })
      .catch((e) => {
        if (!cancelled) {
          setPlan(null);
          setPlanError(plainError(e));
        }
      })
      .finally(() => {
        if (!cancelled) setPlanning(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, count, countOk, useTickets, ticketsOk, bonded, active]);

  if (!node) {
    return (
      <Notice tone="neutral" title="Reading your node…">
        <p>This fills in once Rocket Pool answers.</p>
      </Notice>
    );
  }

  const useCredit = !!plan?.can.canUseCredit;
  const usable = toBigInt(plan?.can.usableCreditBalance) ?? 0n;
  const fromWallet = plan ? (useCredit ? (plan.bondWei > usable ? plan.bondWei - usable : 0n) : plan.bondWei) : 0n;
  const precheck = plan ? blockedReasonFor(plan.can) : null;
  const noClient = reconcileKnown && !client;
  const notSynced = synced === false;
  const canStart = !!plan && !precheck && !noClient && !notSynced && !planning;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 text-sm text-fg">
        <p>
          A <strong>megapool validator</strong> needs a bond of about 4 ETH from you; Rocket Pool's stakers add the rest of the 32 ETH. You
          earn the rewards on your bond plus a commission on theirs.
        </p>
        <p>
          New validators wait in Rocket Pool's queue. When their turn comes, your node stakes them automatically. Their keys are made on
          this AVADO and loaded into your consensus client for you.
        </p>
      </div>

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

      {planning && (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <Spinner size="sm" label="Checking" /> Working out the bond…
        </p>
      )}
      {planError && (
        <Notice tone="danger" title="Could not check the deposit" live>
          <p>{planError}</p>
        </Notice>
      )}
      {plan && !planning && (
        <Facts
          testId="deposit-plan"
          rows={[
            ["Validators", String(plan.count)],
            ["Your bond", formatEth(plan.bondWei)],
            ...(useCredit ? ([["Paid from your credit", formatEth(plan.bondWei - fromWallet)]] as Array<[string, string]>) : []),
            ["Paid from the node wallet", formatEth(fromWallet)],
            ["In the node wallet now", formatEth(plan.can.nodeBalance)],
            ...(tickets > 0 ? ([["Express tickets used", String(useTickets)]] as Array<[string, string]>) : []),
          ]}
        />
      )}
      {precheck && (
        <Notice tone="warning" title="Not possible right now" live>
          <p>{precheck}</p>
        </Notice>
      )}

      <div>
        <Button variant="primary" onClick={() => setOpen(true)} disabled={!canStart}>
          {countOk ? `Create ${plural(count, "validator")}` : "Create validators"}
        </Button>
      </div>

      {created !== null && (
        <Notice tone="success" title={`${plural(created, "validator")} created`} live>
          <p>
            {created === 1 ? "It is" : "They are"} in Rocket Pool's queue now. Your node stakes {created === 1 ? "it" : "them"} automatically
            when {created === 1 ? "its" : "their"} turn comes, and the keys are loaded into {client?.name ?? "your consensus client"} for
            you.
          </p>
        </Notice>
      )}

      <AutoTxNotice />

      {plan && (
        <TransactionFlow<CanDepositResponse>
          open={open}
          title={`Create ${plural(plan.count, "validator")}`}
          summary={
            <>
              Makes {plural(plan.count, "new validator key")} on this AVADO and deposits your bond of{" "}
              <strong className="text-fg">{formatEth(plan.bondWei)}</strong>. The {plan.count === 1 ? "validator joins" : "validators join"}{" "}
              Rocket Pool's queue; you can leave the queue later and get the bond back as credit.
            </>
          }
          tx={{
            canRoute: CAN_DEPOSIT_ROUTE,
            route: DEPOSIT_ROUTE,
            params: depositParams({ count: plan.count, bondWei: plan.bondWei, expressTickets: useTickets, useCredit }),
            blockedReason: (can) =>
              !!can.canUseCredit !== useCredit
                ? "Your credit balance changed since the last check. Close this and try again."
                : blockedReasonFor(can),
            details: (can) => (
              <Facts
                rows={[
                  ["Validators", String(plan.count)],
                  ["Bond", formatEth(plan.bondWei)],
                  ["From the node wallet", formatEth(fromWallet)],
                  ["In the node wallet", formatEth(can.nodeBalance)],
                ]}
              />
            ),
          }}
          confirmLabel="Create validators"
          onClose={() => setOpen(false)}
          onDone={() => {
            setCreated(plan.count);
            void mega.refresh();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/** Why the deposit can't be made, from `can-deposit` (null when it can). */
export function blockedReasonFor(can: CanDepositResponse): string | null {
  if (can.canDeposit === false && can.insufficientBalanceWithoutCredit) {
    return "Your credit can't be used right now because Rocket Pool's deposit pool is low, and the node wallet alone doesn't have enough ETH. Add ETH or try again later.";
  }
  if (can.canDeposit === false && can.insufficientBalance) {
    return `The node wallet doesn't have enough ETH for this bond: it has ${formatEth(can.nodeBalance)}. Add ETH first.`;
  }
  return defaultBlockedReason(can, CAN_DEPOSIT_ROUTE);
}

export default ValidatorsStep;
