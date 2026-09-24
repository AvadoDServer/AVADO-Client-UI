import { useState } from "react";
import { Badge, Button, Card, StatusPill } from "../../../../components/ui";
import { useMode } from "../../../../settings/ModeProvider";
import type { MegapoolDetails, NodeStatus } from "../../api/models";
import {
  getMegapoolPendingRewards,
  getMegapoolStatus,
  getMinipoolCloseDetails,
  getMinipoolDistributeDetails,
  getMinipoolStatus,
  getNodeStatus,
} from "../../api/sn";
import { useRead } from "../../api/useRead";
import { validatorUrl } from "../../lib/explorer";
import { formatEth, toBigInt } from "../../lib/units";
import { useAppStatus } from "../../status/AppStatus";
import { TransactionFlow } from "../../tx/TransactionFlow";
import { Address, Callout, Facts, LoadError, LoadingCard, NodeGate, PageHeader, SectionCard } from "../common";
import {
  claimRefundFlow,
  closeMinipoolFlow,
  distributeMegapoolFlow,
  distributeMinipoolFlow,
  exitMegapoolValidatorFlow,
  exitMinipoolFlow,
  leaveQueueFlow,
  provisionTicketsFlow,
  repayDebtFlow,
  type FlowConfig,
} from "./actions";
import { AddValidatorDialog } from "./AddValidatorDialog";
import { CloseMinipoolFlow } from "./CloseMinipoolFlow";
import { megapoolSummary, megapoolValidatorView, minipoolView, sortMinipools, type MinipoolView } from "./model";

/** Validators: minipools (the existing fleet) and the megapool, with their actions. */
export default function ValidatorsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Validators" description="Your minipools and megapool validators, their status, and what you can do with them." />
      <NodeGate>
        <Validators />
      </NodeGate>
    </div>
  );
}

function BeaconLink({ pubkey, label }: { pubkey: string; label: string }) {
  const href = validatorUrl(pubkey);
  if (!href) return <span>{label}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">
      {label}
      <span className="sr-only"> (opens beaconcha.in in a new tab)</span>
    </a>
  );
}

function Validators() {
  const { daemonReady } = useAppStatus();
  const node = useRead(getNodeStatus, { enabled: daemonReady });
  const status = node.data;
  const hasMinipools = (status?.minipoolCounts.total ?? 0) > 0;
  const hasMegapool = !!status?.megapoolDeployed;
  const minipools = useRead(getMinipoolStatus, { enabled: daemonReady && hasMinipools });
  const close = useRead(getMinipoolCloseDetails, { enabled: daemonReady && hasMinipools });
  const distribute = useRead(getMinipoolDistributeDetails, { enabled: daemonReady && hasMinipools });
  const megapool = useRead(getMegapoolStatus, { enabled: daemonReady && hasMegapool });
  const pending = useRead(getMegapoolPendingRewards, { enabled: daemonReady && hasMegapool });

  const [flow, setFlow] = useState<FlowConfig | null>(null);
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);

  const refreshAll = () => {
    void node.refresh();
    if (hasMinipools) {
      void minipools.refresh();
      void close.refresh();
      void distribute.refresh();
    }
    if (hasMegapool) {
      void megapool.refresh();
      void pending.refresh();
    }
  };

  if (node.error !== undefined && !status) return <LoadError what="your node" error={node.error} onRetry={() => void node.refresh()} />;
  if (!status) return <LoadingCard label="Loading your validators" />;

  const details = megapool.data?.megapoolDetails;
  const noValidators = !hasMinipools && (!details || details.validatorCount === 0);

  return (
    <>
      {noValidators && (
        <Callout tone="accent" title="No validators yet">
          <p>Add a megapool validator to start staking with Rocket Pool. Each one needs a bond of a few ETH from you.</p>
          <div>
            <Button size="sm" onClick={() => setAdding(true)}>
              Add a validator
            </Button>
          </div>
        </Callout>
      )}

      {hasMinipools && (
        <MinipoolSection
          node={status}
          views={
            minipools.data
              ? sortMinipools(minipools.data.minipools.map((mp) => minipoolView(mp, minipools.data?.latestDelegate, close.data?.details, distribute.data?.details)))
              : undefined
          }
          error={minipools.error}
          detailsError={close.error ?? distribute.error}
          onRetry={refreshAll}
          onAction={setFlow}
          onClose={setClosing}
        />
      )}

      {hasMegapool && (
        <>
          {megapool.error !== undefined && !details && <LoadError what="your megapool" error={megapool.error} onRetry={refreshAll} />}
          {!details && megapool.error === undefined && <LoadingCard label="Loading your megapool" />}
          {details && (
            <MegapoolSection
              megapool={details}
              pendingNodeShare={toBigInt(pending.data?.rewardSplit?.NodeRewards)}
              onAction={setFlow}
              onAdd={() => setAdding(true)}
            />
          )}
        </>
      )}

      {!hasMegapool && !noValidators && (
        <SectionCard
          title="Megapool"
          description="New Rocket Pool validators are megapool validators. Your megapool is created with your first one."
          actions={
            <Button size="sm" onClick={() => setAdding(true)}>
              Add a validator
            </Button>
          }
        />
      )}

      {status.minipoolCounts.total > 0 && !status.expressTicketsProvisioned && (
        <Callout tone="accent" title="Your express tickets aren't set up yet">
          <p>Your minipools earn express tickets that let new validators skip ahead in the queue. Your node sets them up automatically when gas is low.</p>
          <div>
            <Button variant="secondary" size="sm" onClick={() => setFlow(provisionTicketsFlow())}>
              Set them up now
            </Button>
          </div>
        </Callout>
      )}

      {flow && (
        <TransactionFlow
          open
          {...flow}
          onClose={() => setFlow(null)}
          onDone={(hash) => {
            flow.onDone?.(hash);
            refreshAll();
          }}
        />
      )}
      {closing && (
        <CloseMinipoolFlow
          address={closing}
          feeDistributorHasBalance={(toBigInt(status.feeDistributorBalance) ?? 0n) > 0n}
          onClose={() => {
            setClosing(null);
            refreshAll();
          }}
          onDone={refreshAll}
        />
      )}
      {adding && (
        <AddValidatorDialog
          megapool={details}
          expressTickets={details?.nodeExpressTicketCount ?? status.expressTicketCount ?? 0}
          nodeEth={toBigInt(status.accountBalances.eth) ?? 0n}
          credit={toBigInt(status.creditBalance) ?? 0n}
          onClose={() => setAdding(false)}
          onDone={refreshAll}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function MinipoolSection({
  node,
  views,
  error,
  detailsError,
  onRetry,
  onAction,
  onClose,
}: {
  node: NodeStatus;
  views: MinipoolView[] | undefined;
  error: unknown;
  detailsError: unknown;
  onRetry: () => void;
  onAction: (f: FlowConfig) => void;
  onClose: (address: string) => void;
}) {
  const feeDistributorHasBalance = (toBigInt(node.feeDistributorBalance) ?? 0n) > 0n;
  return (
    <section aria-labelledby="minipools-heading" className="flex flex-col gap-3">
      <h2 id="minipools-heading" className="text-lg font-semibold text-fg">
        Minipools
      </h2>
      <p className="text-sm text-fg-muted">
        Your minipools keep validating as before. Rocket Pool no longer creates new ones; new validators are megapool validators.
      </p>
      {error !== undefined && !views && <LoadError what="your minipools" error={error} onRetry={onRetry} />}
      {!views && error === undefined && <LoadingCard label="Loading your minipools" />}
      {detailsError !== undefined && views && (
        <Callout tone="warning" title="Some details could not be loaded">
          <p>Closing and distributing may not show until they load. The page tries again by itself.</p>
        </Callout>
      )}
      {views?.map((v) => (
        <MinipoolCard key={v.mp.address} view={v} feeDistributorHasBalance={feeDistributorHasBalance} onAction={onAction} onClose={onClose} />
      ))}
    </section>
  );
}

function MinipoolCard({
  view,
  feeDistributorHasBalance,
  onAction,
  onClose,
}: {
  view: MinipoolView;
  feeDistributorHasBalance: boolean;
  onAction: (f: FlowConfig) => void;
  onClose: (address: string) => void;
}) {
  const { isAdvanced } = useMode();
  const { mp, status } = view;
  const index = mp.validator.index && mp.validator.index !== "0" ? mp.validator.index : null;
  const delegate = view.delegate.followsLatest
    ? "Follows the newest version automatically"
    : view.delegate.upToDate
      ? "The newest version"
      : "An older version: your node switches it to follow the newest one automatically (one small transaction when gas is low)";
  return (
    <Card className="flex flex-col gap-4" data-testid={`minipool-${mp.address.toLowerCase()}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-fg">
            Minipool <Address address={mp.address} />
          </h3>
          <p className="mt-1 text-sm text-fg-muted">{status.text}</p>
        </div>
        <StatusPill status={status} />
      </div>
      <Facts
        items={[
          { label: "Your bond", value: formatEth(mp.node.depositBalance) },
          { label: "Borrowed from Rocket Pool", value: formatEth(mp.user?.depositBalance) },
          { label: "Commission", value: `${(mp.node.fee * 100).toFixed(1).replace(/\.0$/, "")}%` },
          { label: "Balance on the beacon chain", value: mp.validator.exists ? formatEth(mp.validator.balance) : "—" },
          {
            label: "Rewards waiting in the minipool",
            value: formatEth(mp.nodeShareOfETHBalance),
            hint: "Your share; paid out when distributed or closed.",
          },
          {
            label: "Validator",
            value: index ? <BeaconLink pubkey={mp.validatorPubkey} label={`Index ${index}`} /> : <BeaconLink pubkey={mp.validatorPubkey} label="Not on the beacon chain yet" />,
          },
          { label: "Contract version", value: delegate },
        ]}
      />
      {(view.canClose || view.canDistribute || view.canExit) && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {view.canClose && <Button onClick={() => onClose(mp.address)}>Close minipool</Button>}
          {view.canClose && feeDistributorHasBalance && isAdvanced && (
            <Button variant="ghost" onClick={() => onAction(closeMinipoolFlow(mp.address, { bundle: true }))}>
              Close in one bundle…
            </Button>
          )}
          {view.canDistribute && (
            <Button variant="secondary" onClick={() => onAction(distributeMinipoolFlow(mp.address))}>
              Distribute rewards
            </Button>
          )}
          {view.canExit && (
            <Button variant="outline" className="border-danger/60 text-danger-text hover:bg-danger/10" onClick={() => onAction(exitMinipoolFlow(mp.address, mp.validatorPubkey))}>
              Exit…
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function MegapoolSection({
  megapool,
  pendingNodeShare,
  onAction,
  onAdd,
}: {
  megapool: MegapoolDetails;
  pendingNodeShare: bigint | null;
  onAction: (f: FlowConfig) => void;
  onAdd: () => void;
}) {
  const sum = megapoolSummary(megapool);
  const views = megapool.validators.map(megapoolValidatorView);
  return (
    <section aria-labelledby="megapool-heading" className="flex flex-col gap-3">
      <h2 id="megapool-heading" className="text-lg font-semibold text-fg">
        Megapool
      </h2>
      <SectionCard
        title={
          <>
            Your megapool <Address address={megapool.address} />
          </>
        }
        description="All your megapool validators share this contract. Its rewards collect here until they are distributed."
        actions={
          <Button size="sm" onClick={onAdd} disabled={sum.hasDebt}>
            Add a validator
          </Button>
        }
        data-testid="megapool"
      >
        <Facts
          items={[
            { label: "Validators", value: `${megapool.activeValidatorCount} active of ${megapool.validatorCount}` },
            { label: "Your bond", value: formatEth(megapool.nodeBond), hint: (toBigInt(megapool.nodeQueuedBond) ?? 0n) > 0n ? `plus ${formatEth(megapool.nodeQueuedBond)} for validators in the queue` : undefined },
            { label: "Rewards waiting (your share)", value: pendingNodeShare !== null ? formatEth(pendingNodeShare) : formatEth(megapool.pendingRewards) },
            { label: "Express tickets", value: String(megapool.nodeExpressTicketCount) },
            ...(sum.hasRefund ? [{ label: "Refund for you", value: formatEth(sum.refund) }] : []),
            ...(sum.hasDebt ? [{ label: "Debt", value: formatEth(sum.debt) }] : []),
          ]}
        />
        {megapool.delegateExpired && (
          <Callout tone="warning" title="Your megapool's contract version has expired">
            <p>Rocket Pool upgrades it automatically. Until then some actions may not work.</p>
          </Callout>
        )}
        {sum.hasDebt && (
          <Callout tone="warning" title={`Your megapool owes ${formatEth(sum.debt)}`}>
            <p>You can't add validators until it is repaid.</p>
          </Callout>
        )}
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="secondary" onClick={() => onAction(distributeMegapoolFlow(pendingNodeShare))}>
            Distribute rewards
          </Button>
          {sum.hasRefund && (
            <Button variant="secondary" onClick={() => onAction(claimRefundFlow(sum.refund))}>
              Claim refund
            </Button>
          )}
          {sum.hasDebt && <Button onClick={() => onAction(repayDebtFlow(sum.debt))}>Repay debt</Button>}
        </div>
      </SectionCard>

      {views.length === 0 && <p className="text-sm text-fg-muted">No validators in your megapool yet.</p>}
      {views.map(({ v, status, canExit, canLeaveQueue, index }) => (
        <Card key={v.validatorId} className="flex flex-col gap-3" data-testid={`megapool-validator-${v.validatorId}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-fg">
                Validator {v.validatorId}
                {v.expressUsed && (
                  <Badge variant="accent" className="ml-2 align-middle">
                    Express
                  </Badge>
                )}
              </h3>
              <p className="mt-1 text-sm text-fg-muted">{status.text}</p>
            </div>
            <StatusPill status={status} />
          </div>
          <Facts
            items={[
              { label: "Beacon chain", value: index ? <BeaconLink pubkey={v.pubKey} label={`Index ${index}`} /> : "Not on the beacon chain yet" },
              ...(v.beaconStatus?.exists && v.beaconStatus.balance > 0
                ? [{ label: "Balance", value: formatEth(BigInt(v.beaconStatus.balance) * 1_000_000_000n) }]
                : []),
            ]}
          />
          {(canExit || canLeaveQueue) && (
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              {canLeaveQueue && (
                <Button variant="secondary" onClick={() => onAction(leaveQueueFlow(v))}>
                  Leave the queue…
                </Button>
              )}
              {canExit && index && (
                <Button variant="outline" className="border-danger/60 text-danger-text hover:bg-danger/10" onClick={() => onAction(exitMegapoolValidatorFlow(v, index))}>
                  Exit…
                </Button>
              )}
            </div>
          )}
        </Card>
      ))}
    </section>
  );
}
