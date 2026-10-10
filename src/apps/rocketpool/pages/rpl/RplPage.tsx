import { useState, type ReactNode } from "react";
import { Button, Input } from "../../../../components/ui";
import { getNodeStatus } from "../../api/sn";
import { useRead } from "../../api/useRead";
import { formatDateTime, formatDuration } from "../../lib/time";
import { formatRpl, formatUnits, parseUnits } from "../../lib/units";
import { useAppStatus } from "../../status/AppStatus";
import { CAN_RULES } from "../../tx/rules";
import { TransactionFlow } from "../../tx/TransactionFlow";
import { Address, Callout, Facts, LoadError, LoadingCard, NodeGate, PageHeader, SectionCard } from "../common";
import type { FlowConfig } from "../validators/actions";
import { checkAmount, rplPayoutTo, rplView, unstakeEffect, type UnstakeEffect } from "./model";
import { StakeRplFlow } from "./StakeRplFlow";

/** RPL (Advanced): stake on the megapool, unstake legacy or megapool RPL, and withdraw after the unstaking period. */
export default function RplPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="RPL" description="Staking, unstaking and withdrawing RPL. RPL is optional for megapool validators." />
      <NodeGate>
        <Rpl />
      </NodeGate>
    </div>
  );
}

function AmountForm({
  label,
  max,
  button,
  disabled,
  onSubmit,
  hint,
}: {
  label: string;
  max: bigint;
  button: string;
  disabled?: boolean;
  onSubmit: (wei: bigint) => void;
  hint?: ReactNode;
}) {
  const [text, setText] = useState("");
  const { wei, error } = checkAmount(parseUnits(text), text, max);
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-start"
      onSubmit={(e) => {
        e.preventDefault();
        if (wei !== null && !disabled) onSubmit(wei);
      }}
    >
      <Input
        className="sm:flex-1"
        label={label}
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        error={error}
        hint={hint ?? `Up to ${formatRpl(max)}`}
        disabled={disabled}
      />
      <div className="flex gap-2 sm:mt-7">
        <Button variant="ghost" size="md" type="button" onClick={() => setText(formatUnits(max, { maxDecimals: 18, grouping: false }))} disabled={disabled || max === 0n}>
          Max
        </Button>
        <Button type="submit" variant="secondary" disabled={disabled || wei === null}>
          {button}
        </Button>
      </div>
    </form>
  );
}

/** What unstaking more does to RPL already unstaking, in plain words (contract rule: see `unstakeEffect`). */
function UnstakeEffectText({ effect, periodText, payoutTo }: { effect: UnstakeEffect; periodText: string; payoutTo: string }) {
  if (effect.kind === "restart") {
    return (
      <>
        <p>
          <strong>{formatRpl(effect.amount)} is already unstaking</strong>
          {effect.currentEnd !== null ? ` and can be withdrawn from ${formatDateTime(effect.currentEnd)}` : ""}. Unstaking more
          restarts the wait ({periodText}) for all of it
          {effect.newEnd !== null ? `: everything would be withdrawable around ${formatDateTime(effect.newEnd)}` : ""}.
        </p>
        <p>To keep the earlier date, wait until it has been withdrawn before unstaking more.</p>
      </>
    );
  }
  if (effect.kind === "ready") {
    return (
      <p>
        <strong>{formatRpl(effect.amount)} has finished unstaking.</strong> Unstaking more normally pays it out to {payoutTo} first, then
        the wait ({periodText}) starts for the new amount only. If Rocket Pool can't pay it out at that moment, it waits again with the
        rest, so the sure way is to withdraw it first.
      </p>
    );
  }
  return null;
}

function Rpl() {
  const { daemonReady } = useAppStatus();
  const node = useRead(getNodeStatus, { enabled: daemonReady });
  const [flow, setFlow] = useState<FlowConfig | null>(null);
  const [stake, setStake] = useState<bigint | null>(null);

  if (node.error !== undefined && !node.data) return <LoadError what="your node" error={node.error} onRetry={() => void node.refresh()} />;
  if (!node.data) return <LoadingCard label="Loading your RPL" />;
  const status = node.data;
  const v = rplView(status, Date.now());
  const blockedByAddress = v.otherRplAddress !== null;
  const refresh = () => void node.refresh();
  const effect = unstakeEffect(v, Date.now());
  const periodText = v.periodMs ? formatDuration(v.periodMs) : "28 days";
  const payoutTo = rplPayoutTo(status, v.otherRplAddress);
  const withdrawFlow: FlowConfig = {
    title: `Withdraw ${formatRpl(v.unstaking)}`,
    summary: <p>Withdraws the RPL that finished unstaking to {payoutTo}. It is no longer staked afterwards.</p>,
    tx: { canRoute: "node/can-withdraw-rpl", route: "node/withdraw-rpl", blockedReason: CAN_RULES["node/can-withdraw-rpl"] },
    confirmLabel: "Withdraw",
  };
  /** Shown in both unstake cards and both confirm dialogs while RPL is already unstaking. */
  const effectNote =
    effect.kind === "none" ? null : (
      <Callout tone="warning" title={effect.kind === "ready" ? "Withdraw your unstaked RPL first" : "This restarts the wait"}>
        <UnstakeEffectText effect={effect} periodText={periodText} payoutTo={payoutTo} />
        {effect.kind === "ready" && (
          <div>
            <Button variant="secondary" size="sm" onClick={() => setFlow(withdrawFlow)} disabled={blockedByAddress}>
              Withdraw ready RPL first
            </Button>
          </div>
        )}
      </Callout>
    );
  const unstakeSummary = (text: string) => (
    <div className="flex flex-col gap-2">
      <p>{text}</p>
      {effect.kind !== "none" && (
        <div role="note" className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning-subtle p-3 text-warning-text">
          <UnstakeEffectText effect={effect} periodText={periodText} payoutTo={payoutTo} />
          {effect.kind === "ready" && <p>To withdraw it first, cancel this and use &ldquo;Withdraw ready RPL first&rdquo;.</p>}
        </div>
      )}
    </div>
  );

  return (
    <>
      <SectionCard title="Your RPL" data-testid="rpl-summary">
        <Facts
          items={[
            { label: "In the node wallet", value: formatRpl(v.wallet) },
            { label: "Staked on your megapool", value: formatRpl(v.megapool) },
            {
              label: "Staked for minipools (legacy)",
              value: formatRpl(v.legacy),
              hint: v.legacyMinimum > 0n ? `At least ${formatRpl(v.legacyMinimum)} must stay staked while you have minipools.` : undefined,
            },
            { label: "Unstaking", value: formatRpl(v.unstaking) },
            ...(v.locked > 0n ? [{ label: "Locked (governance bonds)", value: formatRpl(v.locked) }] : []),
          ]}
        />
        {blockedByAddress && (
          <Callout tone="warning" title="Only your RPL withdrawal address can unstake or withdraw">
            <p>
              Your node has a separate RPL withdrawal address, <Address address={v.otherRplAddress!} />. Unstaking and withdrawing RPL is
              done from that address (for example on the Rocket Pool website), not from this node.
            </p>
          </Callout>
        )}
      </SectionCard>

      {v.unstaking > 0n && (
        <SectionCard title="Unstaking RPL" data-testid="rpl-unstaking">
          {v.unstakingState === "waiting" && v.withdrawableAt !== null ? (
            <p className="text-sm text-fg">
              {formatRpl(v.unstaking)} is unstaking. You can withdraw it from <strong>{formatDateTime(v.withdrawableAt)}</strong> (in about{" "}
              {formatDuration(v.withdrawableAt - Date.now())}).
            </p>
          ) : (
            <>
              <p className="text-sm text-fg">
                {formatRpl(v.unstaking)} has finished unstaking and can be withdrawn to {payoutTo}.
              </p>
              <div>
                <Button
                  onClick={() => setFlow(withdrawFlow)}
                  disabled={blockedByAddress}
                >
                  Withdraw RPL
                </Button>
              </div>
            </>
          )}
        </SectionCard>
      )}

      <SectionCard
        title="Stake RPL on your megapool"
        description="Optional. Staked RPL earns a share of the RPL rewards and gives voting power in the Rocket Pool DAO."
      >
        <AmountForm label="RPL to stake" max={v.wallet} button="Stake…" onSubmit={setStake} />
      </SectionCard>

      <SectionCard
        title="Unstake megapool RPL"
        description={`Unstaked RPL can be withdrawn after the unstaking period (${periodText}). Unstaking again restarts the wait for all RPL that is still unstaking.`}
      >
        {effectNote}
        <AmountForm
          label="RPL to unstake"
          max={v.megapoolUnstakable}
          button="Unstake…"
          disabled={blockedByAddress || v.megapoolUnstakable === 0n}
          onSubmit={(wei) =>
            setFlow({
              title: `Unstake ${formatRpl(wei)} from your megapool`,
              summary: unstakeSummary(
                `Starts the unstaking period for ${formatRpl(wei)}. It stops earning rewards now; you can withdraw it once the period has ended.`,
              ),
              tx: { canRoute: "node/can-unstake-rpl", route: "node/unstake-rpl", params: { amountWei: wei.toString() }, blockedReason: CAN_RULES["node/can-unstake-rpl"] },
              confirmLabel: "Unstake",
            })
          }
        />
      </SectionCard>

      <SectionCard
        title="Unstake legacy RPL"
        description={`RPL staked for your minipools. While you have minipools, at least ${v.minimumPercent}% of the ETH they borrowed must stay staked as RPL.`}
      >
        {effectNote}
        <AmountForm
          label="Legacy RPL to unstake"
          max={v.legacyUnstakable}
          button="Unstake…"
          disabled={blockedByAddress || v.legacyUnstakable === 0n}
          hint={
            v.legacyUnstakable === 0n && v.legacy > 0n
              ? "All of it is needed for your minipools right now."
              : `Up to ${formatRpl(v.legacyUnstakable)} (keeping the ${formatRpl(v.legacyMinimum)} minimum)`
          }
          onSubmit={(wei) =>
            setFlow({
              title: `Unstake ${formatRpl(wei)} of legacy RPL`,
              summary: unstakeSummary(
                `Starts the unstaking period for ${formatRpl(wei)} of the RPL staked for your minipools. You can withdraw it once the period has ended.`,
              ),
              tx: {
                canRoute: "node/can-unstake-legacy-rpl",
                route: "node/unstake-legacy-rpl",
                params: { amountWei: wei.toString() },
                blockedReason: CAN_RULES["node/can-unstake-legacy-rpl"],
              },
              confirmLabel: "Unstake",
            })
          }
        />
      </SectionCard>

      {flow && (
        <TransactionFlow
          key={flow.tx.route}
          open
          {...flow}
          onClose={() => {
            setFlow(null);
            refresh();
          }}
          onDone={refresh}
        />
      )}
      {stake !== null && (
        <StakeRplFlow
          amount={stake}
          onClose={() => {
            setStake(null);
            refresh();
          }}
          onDone={refresh}
        />
      )}
    </>
  );
}
