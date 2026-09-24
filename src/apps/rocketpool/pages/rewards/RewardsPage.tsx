import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Input } from "../../../../components/ui";
import { useMode } from "../../../../settings/ModeProvider";
import {
  getFeeDistributorCanDistribute,
  getMegapoolCanDistribute,
  getMegapoolPendingRewards,
  getMinipoolDistributeDetails,
  getNodeStatus,
  getRewardsInfo,
} from "../../api/sn";
import { useRead } from "../../api/useRead";
import { formatEth, formatRpl, parseUnits } from "../../lib/units";
import { useAppStatus } from "../../status/AppStatus";
import { TransactionFlow } from "../../tx/TransactionFlow";
import { Address, Callout, Facts, LoadError, LoadingCard, NodeGate, PageHeader, SectionCard } from "../common";
import { claimFlow, itemLabel } from "./actions";
import { blockedIntervals, claimItems, claimTotals, payoutAddress, type ClaimItem } from "./model";

/** Rewards: everything that can be claimed, one transaction per source, and "claim everything" one step at a time. */
export default function RewardsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Rewards" description="What your node has earned and not yet collected, and claiming it." />
      <NodeGate>
        <Rewards />
      </NodeGate>
    </div>
  );
}

/** "Claim everything": the items as they were when it started, done one after another. */
interface Sequence {
  items: ClaimItem[];
  /** The open step. */
  at: number;
  /** Ids whose transaction went through. */
  done: string[];
  stopped?: boolean;
}

function Rewards() {
  const { daemonReady } = useAppStatus();
  const { isAdvanced } = useMode();
  const node = useRead(getNodeStatus, { enabled: daemonReady });
  const status = node.data;
  const hasMinipools = (status?.minipoolCounts.total ?? 0) > 0;
  const hasMegapool = !!status?.megapoolDeployed;
  const rewards = useRead(getRewardsInfo, { enabled: daemonReady && !!status });
  const megapoolCan = useRead(getMegapoolCanDistribute, { enabled: daemonReady && hasMegapool });
  const megapoolPending = useRead(getMegapoolPendingRewards, { enabled: daemonReady && hasMegapool });
  const feeDistributor = useRead(getFeeDistributorCanDistribute, { enabled: daemonReady && !!status?.isFeeDistributorInitialized });
  const minipoolBalances = useRead(getMinipoolDistributeDetails, { enabled: daemonReady && hasMinipools });

  const [open, setOpen] = useState<ClaimItem | null>(null);
  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [restake, setRestake] = useState(false);
  const [restakeText, setRestakeText] = useState("");

  const refreshAll = () => {
    void node.refresh();
    void rewards.refresh();
    if (hasMegapool) {
      void megapoolCan.refresh();
      void megapoolPending.refresh();
    }
    if (status?.isFeeDistributorInitialized) void feeDistributor.refresh();
    if (hasMinipools) void minipoolBalances.refresh();
  };

  if (node.error !== undefined && !status) return <LoadError what="your node" error={node.error} onRetry={() => void node.refresh()} />;
  if (!status) return <LoadingCard label="Loading your rewards" />;

  const items = claimItems({
    node: status,
    rewards: rewards.data,
    megapoolCan: megapoolCan.data,
    megapoolPending: megapoolPending.data,
    feeDistributor: feeDistributor.data,
    minipoolBalances: minipoolBalances.data?.details,
  });
  const totals = claimTotals(items);
  const periodic = items.find((i) => i.kind === "periodic");
  // The total is shown only once every source has answered: a partial sum would read as the whole.
  const reads = [
    rewards,
    ...(hasMegapool ? [megapoolCan, megapoolPending] : []),
    ...(status.isFeeDistributorInitialized ? [feeDistributor] : []),
    ...(hasMinipools ? [minipoolBalances] : []),
  ];
  // No answer yet (also in the render right after a read is switched on, before its first poll starts).
  const stillLoading = reads.some((r) => r.data === undefined && r.error === undefined);
  const failed = [rewards, megapoolCan, megapoolPending, feeDistributor, minipoolBalances].some((r) => r.error !== undefined);
  const blocked = blockedIntervals(rewards.data);
  const payout = payoutAddress(status);

  // The restake amount: all of it by default, or what the owner typed (never more than the RPL claimed).
  const typedRestake = restakeText.trim() === "" ? null : parseUnits(restakeText);
  const restakeError =
    restake && typedRestake === null && restakeText.trim() !== ""
      ? "Enter an amount like 12.5"
      : restake && periodic && typedRestake !== null && typedRestake > periodic.rpl
        ? `At most ${formatRpl(periodic.rpl)}`
        : undefined;
  const restakeAmount = restake && periodic && !restakeError ? (typedRestake ?? periodic.rpl) : 0n;

  const running = !!sequence && !sequence.stopped;
  const current = running ? sequence!.items[sequence!.at] : open;
  const flow = current ? claimFlow(current, { nodeAddress: status.accountAddress, restakeRpl: restakeAmount }) : null;

  const startAll = () => {
    setOpen(null);
    setSequence({ items, at: 0, done: [] });
  };

  const onFlowClose = () => {
    if (!sequence || sequence.stopped) {
      setOpen(null);
      refreshAll();
      return;
    }
    // Only a claim that went through moves on; closing any other way stops here.
    const head = sequence.items[sequence.at];
    const next = sequence.at + 1;
    if (sequence.done.includes(head.id) && next < sequence.items.length) setSequence({ ...sequence, at: next });
    else setSequence({ ...sequence, stopped: true });
    refreshAll();
  };

  return (
    <>
      <SectionCard
        title="Ready to claim"
        description={
          <>
            Paid to {payout.isNodeWallet ? "your node wallet" : "your withdrawal address"} <Address address={payout.address} />.
          </>
        }
        data-testid="claim-summary"
      >
        {stillLoading ? (
          <p className="text-sm text-fg-muted">Checking what your node has earned…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-fg-muted">There is nothing to claim right now. Rewards are counted every 28 days (a reward period).</p>
        ) : (
          <>
            <p className="font-display text-2xl font-bold text-fg" data-testid="claim-total">
              {totals.approx ? "about " : ""}
              {formatEth(totals.eth)}
              {totals.rpl > 0n ? ` + ${formatRpl(totals.rpl)}` : ""}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={startAll} disabled={!!restakeError || running}>{items.length === 1 ? "Claim" : `Claim everything (${items.length} transactions)`}</Button>
              {items.length > 1 && <p className="text-xs text-fg-muted">Each one is a separate transaction: you confirm them one at a time.</p>}
            </div>
          </>
        )}
        {payout.isNodeWallet && (
          <Callout tone="warning" title="Rewards go to the node wallet">
            <p>Your withdrawal address is still the node wallet on this AVADO. Set a withdrawal address you control (a hardware wallet) from the Home page.</p>
          </Callout>
        )}
        {failed && (
          <Callout tone="warning" title="Some rewards could not be checked">
            <p>The list may be incomplete. It is checked again every minute.</p>
          </Callout>
        )}
        {blocked.length > 0 && (
          <Callout tone="accent" title={`${blocked.length} reward period${blocked.length === 1 ? " isn't" : "s aren't"} ready to claim yet`}>
            <p>Your node is still downloading the rewards file for {blocked.length === 1 ? "it" : "them"}. Try again later.</p>
          </Callout>
        )}
        {sequence?.stopped && (
          <Callout
            tone={sequence.done.length === sequence.items.length ? "success" : "neutral"}
            title={sequence.done.length === sequence.items.length ? "Everything was claimed" : "Stopped"}
            role="status"
          >
            <p>
              {sequence.done.length} of {sequence.items.length} claimed.
              {sequence.done.length < sequence.items.length ? " You can claim the rest below, one at a time." : ""}
            </p>
          </Callout>
        )}
      </SectionCard>

      {!stillLoading && items.length > 0 && (
        <section aria-labelledby="claim-items" className="flex flex-col gap-3">
          <h2 id="claim-items" className="text-lg font-semibold text-fg">
            What makes it up
          </h2>
          {items.map((item) => (
            <Card key={item.id} className="flex flex-col gap-3" data-testid={`claim-${item.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-fg">{itemLabel(item)}</h3>
                  <p className="mt-1 text-sm text-fg-muted">{item.text}</p>
                </div>
                <p className="font-semibold text-fg">
                  {item.approx ? "about " : ""}
                  {item.eth > 0n || item.rpl === 0n ? formatEth(item.eth) : ""}
                  {item.eth > 0n && item.rpl > 0n ? " + " : ""}
                  {item.rpl > 0n ? formatRpl(item.rpl) : ""}
                </p>
              </div>
              {item.kind === "periodic" && (
                <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-fg">
                    <input type="checkbox" checked={restake} onChange={(e) => setRestake(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
                    Stake the RPL again instead of paying it out
                  </label>
                  {restake && (
                    <Input
                      label="RPL to stake"
                      inputMode="decimal"
                      placeholder={`All: ${formatRpl(item.rpl)}`}
                      value={restakeText}
                      onChange={(e) => setRestakeText(e.target.value)}
                      error={restakeError}
                      hint="Leave empty to stake all of it. Staked RPL earns a share of rewards; unstaking takes 28 days."
                    />
                  )}
                </div>
              )}
              <div>
                <Button variant="secondary" size="sm" onClick={() => setOpen(item)} disabled={running || (item.kind === "periodic" && !!restakeError)}>
                  {item.kind === "periodic" ? (restake ? "Claim and stake" : "Claim") : item.kind === "credit" || item.kind === "eth-on-behalf" ? "Withdraw" : item.kind === "unclaimed" ? "Claim" : "Distribute"}
                </Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      <SectionCard title="Smoothing pool" description="Pooling tips and MEV with other Rocket Pool nodes, paid out with the periodic rewards.">
        <p className="text-sm text-fg">
          {status.feeRecipientInfo.isInSmoothingPool
            ? "Your node is in the smoothing pool: its tips and MEV are shared and your part is included in the periodic rewards above."
            : status.feeRecipientInfo.isInOptOutCooldown
              ? "Your node is leaving the smoothing pool. Until that is final, its tips still go to the pool."
              : "Your node is not in the smoothing pool: its tips and MEV go to its own fee distributor or megapool, listed above when there is something to collect."}
        </p>
      </SectionCard>

      <SectionCard
        title="Staked RPL"
        description="RPL is optional for megapool validators. Staked RPL earns a share of the RPL rewards."
        actions={
          isAdvanced ? (
            <Button as={Link} to="/rpl" variant="secondary" size="sm">
              Manage RPL
            </Button>
          ) : undefined
        }
      >
        <Facts
          items={[
            { label: "Staked (legacy, for minipools)", value: formatRpl(status.rplStakeLegacy) },
            { label: "Staked on your megapool", value: formatRpl(status.rplStakeMegapool) },
            { label: "In the node wallet", value: formatRpl(status.accountBalances.rpl) },
          ]}
        />
        {!isAdvanced && <p className="text-xs text-fg-muted">Switch to Advanced mode to stake, unstake or withdraw RPL.</p>}
      </SectionCard>

      {flow && current && (
        <TransactionFlow
          key={current.id}
          open
          {...flow}
          title={running ? `Step ${sequence!.at + 1} of ${sequence!.items.length}: ${flow.title}` : flow.title}
          onClose={onFlowClose}
          onDone={(hash) => {
            flow.onDone?.(hash);
            setSequence((s) => (s && s.items[s.at]?.id === current.id ? { ...s, done: [...s.done, current.id] } : s));
          }}
        />
      )}
    </>
  );
}
