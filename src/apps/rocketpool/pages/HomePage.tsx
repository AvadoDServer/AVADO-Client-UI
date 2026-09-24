import { Link } from "react-router-dom";
import { Button, Card, CardDescription, CardTitle, StatusDot, StatusPill, cn, type StatusTone } from "../../../components/ui";
import type { Problem } from "../../../components/shell/problems";
import { plainError } from "../api/errors";
import type { MegapoolValidator, NodeStatus, NodeSync, RewardsInfo } from "../api/models";
import { reconcileStatusOf } from "../api/reconcile";
import { isMock } from "../api/RocketpoolApiProvider";
import { AutoTxNotice, Facts } from "../components/common";
import { useMegapoolStatus, useNodeReadable, useNodeStatus, useNodeSync, useRewardsInfo } from "../data/nodeReads";
import { formatEth, formatRpl, formatUnits, toBigInt } from "../lib/units";
import { useAppStatus } from "../status/AppStatus";
import { serviceStatus } from "../status/daemon";
import { findNodeProblems } from "../status/problems";
import { KeyApproval } from "./home/KeyApproval";
import { LegacyMnemonic } from "./home/LegacyMnemonic";

const TONE_BOX = {
  danger: "border-danger/25 bg-danger-subtle",
  warning: "border-warning/25 bg-warning-subtle",
  accent: "border-accent/25 bg-accent-subtle",
} as const;

/** Home's own fixes (the ones that need a node read), styled like the shell's banners. */
function NodeFixes({ problems }: { problems: Problem<string>[] }) {
  if (problems.length === 0) return null;
  return (
    <section aria-label="Things to fix" className="flex flex-col gap-3">
      {problems.map((p) => (
        <div key={p.id} data-problem={p.id} className={cn("flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center", TONE_BOX[p.tone])}>
          <div className="flex min-w-0 flex-1 gap-3">
            <StatusDot tone={p.tone} className="mt-1.5" />
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-semibold leading-snug text-fg">{p.title}</p>
              <p className="mt-0.5 text-sm text-fg [overflow-wrap:anywhere]">{p.body}</p>
            </div>
          </div>
          {p.action.to && (
            <Button as={Link} to={p.action.to} size="sm" variant="secondary" className="flex-shrink-0 self-start sm:self-center">
              {p.action.label}
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}

type Pill = { tone: StatusTone; label: string };

const pill = (ok: boolean | undefined, yes: string, no: string): Pill =>
  ok === undefined ? { tone: "neutral", label: "Checking" } : ok ? { tone: "success", label: yes } : { tone: "warning", label: no };

function syncPill(c: NodeSync["ecStatus"] | undefined): Pill {
  if (!c) return { tone: "neutral", label: "Checking" };
  const p = c.primaryEcStatus;
  if (!p.isWorking) return { tone: "danger", label: "Not answering" };
  if (p.isSynced) return { tone: "success", label: "In sync" };
  return { tone: "warning", label: `Syncing ${Math.floor(Math.max(0, Math.min(1, p.syncProgress)) * 100)}%` };
}

/** Megapool validators by what they are doing. */
export function megapoolCounts(validators: MegapoolValidator[] | undefined) {
  const v = validators ?? [];
  return {
    active: v.filter((x) => x.staked && !x.exiting && !x.exited).length,
    queued: v.filter((x) => !x.staked && !x.exited && !x.dissolved && (x.inQueue || x.inPrestake)).length,
    exiting: v.filter((x) => x.exiting && !x.exited).length,
    exited: v.filter((x) => x.exited).length,
  };
}

/** Unclaimed periodic rewards: RPL and smoothing-pool ETH over the unclaimed intervals. */
export function unclaimedRewards(info: RewardsInfo | undefined): { rpl: bigint; eth: bigint; intervals: number } | null {
  if (!info) return null;
  let rpl = 0n;
  let eth = 0n;
  for (const i of info.unclaimedIntervals ?? []) {
    rpl += (toBigInt(i.collateralRplAmount) ?? 0n) + (toBigInt(i.oDaoRplAmount) ?? 0n);
    eth += toBigInt(i.smoothingPoolEthAmount) ?? 0n;
  }
  return { rpl, eth, intervals: info.unclaimedIntervals?.length ?? 0 };
}

function SetupCallout({ walletReady, node }: { walletReady: boolean; node?: NodeStatus }) {
  let title: string | null = null;
  let text = "";
  let label = "Continue setup";
  let to = "/setup";
  if (!walletReady) {
    title = "Set up your Rocket Pool node";
    text = "Create or restore the node wallet, register the node and start your first validators. It takes a few steps.";
    label = "Start setup";
  } else if (node && !node.registered) {
    title = "Finish setting up your node";
    text = "Your node wallet is ready. Next: add ETH and register the node with Rocket Pool.";
  } else if (node && node.registered && (node.minipoolCounts?.total ?? 0) === 0 && !node.megapoolDeployed) {
    title = "Create your first validators";
    text = "Your node is registered. Create megapool validators with a bond of about 4 ETH each.";
    label = "Create validators";
    to = "/setup/validators";
  }
  if (!title) return null;
  return (
    <Card as="section" aria-label="Setup" className="flex flex-col gap-3 sm:flex-row sm:items-center" data-testid="setup-callout">
      <div className="min-w-0 flex-1">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{text}</CardDescription>
      </div>
      <Button as={Link} to={to} variant="primary" className="flex-shrink-0 self-start sm:self-center">
        {label}
      </Button>
    </Card>
  );
}

function CardLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="text-sm font-semibold text-accent underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}

/** Home (spec §4.1): health, balances, validators, rewards, and what needs the owner. */
export default function HomePage() {
  const status = useAppStatus();
  const { avado, reconcile } = status;
  const version = avado?.packageVersion;
  const readable = useNodeReadable();
  const nodePoll = useNodeStatus(readable);
  const node = readable ? nodePoll.data : undefined;
  const registered = !!node?.registered;
  const sync = useNodeSync(readable);
  const mega = useMegapoolStatus(registered && !!node?.megapoolDeployed);
  const rewards = useRewardsInfo(registered);
  const keyCheck = reconcileStatusOf(reconcile);
  const walletReady = !!avado?.walletFilePresent;

  const problems = findNodeProblems(node);
  const mp = megapoolCounts(mega.data?.megapoolDetails.validators);
  const minipools = node?.minipoolCounts;
  const unclaimed = unclaimedRewards(rewards.data);
  const nodeError = readable && nodePoll.error !== undefined && !nodePoll.data ? plainError(nodePoll.error) : null;
  const credit = toBigInt(node?.creditBalance) ?? 0n;
  const feeDistributor =
    node && node.feeRecipientInfo.hasMinipools && !node.feeRecipientInfo.isInSmoothingPool ? toBigInt(node.feeDistributorBalance) : null;
  const megaPending = toBigInt(mega.data?.megapoolDetails.pendingRewards);
  const reth = toBigInt(node?.accountBalances.reth);

  const megaText = !node?.megapoolDeployed
    ? "None"
    : mega.data
      ? [`${mp.active} active`, mp.queued ? `${mp.queued} in the queue` : "", mp.exiting ? `${mp.exiting} exiting` : "", mp.exited ? `${mp.exited} exited` : ""]
          .filter(Boolean)
          .join(", ")
      : "Checking";
  const minipoolText = !minipools || minipools.total === 0 ? "None" : `${minipools.staking} staking${minipools.total > minipools.staking ? ` (${minipools.total} in total)` : ""}`;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-4xl font-bold tracking-tight text-fg">Home</h1>

      {avado && <SetupCallout walletReady={walletReady} node={node} />}
      <KeyApproval />
      <LegacyMnemonic />
      <NodeFixes problems={problems} />
      {nodeError && (
        <p className="text-sm text-danger-text" role="alert">
          Could not read your node: {nodeError}
        </p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
        <Card as="section" aria-labelledby="health-title" className="flex flex-col gap-3">
          <CardTitle id="health-title">Node health</CardTitle>
          <div className="flex flex-wrap items-center gap-3 text-sm text-fg" data-testid="service-status">
            <StatusPill status={serviceStatus(status)} />
            {isMock() && <StatusPill status={{ tone: "accent", label: "Demo data" }} />}
          </div>
          <Facts
            testId="health"
            rows={[
              ["Node wallet", <StatusPill key="w" status={pill(avado ? walletReady : undefined, "Ready", "Not set up")} />],
              [
                "Registered with Rocket Pool",
                <StatusPill key="r" status={walletReady ? pill(node ? registered : undefined, "Yes", "Not yet") : { tone: "neutral", label: "Not yet" }} />,
              ],
              ["Execution client", <StatusPill key="e" status={readable ? syncPill(sync.data?.ecStatus) : { tone: "neutral", label: "Unknown" }} />],
              ["Consensus client", <StatusPill key="c" status={readable ? syncPill(sync.data?.bcStatus) : { tone: "neutral", label: "Unknown" }} />],
              [
                "Validator keys",
                keyCheck?.client ? `${keyCheck.keys.summary || "0/0"} in sync with ${keyCheck.client.name}` : keyCheck?.state === "waiting" || !keyCheck ? "Not checked yet" : "No consensus client",
              ],
            ]}
          />
          {version && <CardDescription>Package version {version}</CardDescription>}
        </Card>

        <Card as="section" aria-labelledby="balances-title" className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <CardTitle id="balances-title">Node wallet</CardTitle>
            {node && <CardLink to="/wallet">Wallet</CardLink>}
          </div>
          {node ? (
            <Facts
              testId="balances"
              rows={[
                ["ETH", formatEth(node.accountBalances.eth)],
                ["RPL", formatRpl(node.accountBalances.rpl)],
                ["rETH", reth === null ? "—" : `${formatUnits(reth)} rETH`],
                ...(credit > 0n ? ([["Credit for new validators", formatEth(credit)]] as Array<[string, string]>) : []),
              ]}
            />
          ) : (
            <CardDescription>{walletReady ? "Shows here once Rocket Pool answers." : "No node wallet yet."}</CardDescription>
          )}
        </Card>

        <Card as="section" aria-labelledby="validators-title" className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <CardTitle id="validators-title">Validators</CardTitle>
            {registered && <CardLink to="/validators">All validators</CardLink>}
          </div>
          {registered ? (
            <Facts
              testId="validators-summary"
              rows={[
                ["Minipools", minipoolText],
                ["Megapool validators", megaText],
              ]}
            />
          ) : (
            <CardDescription>{node ? "Register your node to create validators." : "None yet."}</CardDescription>
          )}
        </Card>

        <Card as="section" aria-labelledby="rewards-title" className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <CardTitle id="rewards-title">Rewards</CardTitle>
            {registered && <CardLink to="/rewards">Rewards</CardLink>}
          </div>
          {registered && unclaimed ? (
            <Facts
              testId="rewards-summary"
              rows={[
                ["Periodic rewards to claim", unclaimed.intervals === 0 ? "None" : `${formatRpl(unclaimed.rpl)} and ${formatEth(unclaimed.eth)}`],
                ...(feeDistributor !== null && feeDistributor > 0n ? ([["Waiting in your fee distributor", formatEth(feeDistributor)]] as Array<[string, string]>) : []),
                ...(megaPending !== null && megaPending > 0n ? ([["Waiting in your megapool", formatEth(megaPending)]] as Array<[string, string]>) : []),
              ]}
            />
          ) : (
            <CardDescription>{registered ? (rewards.error !== undefined ? plainError(rewards.error) : "Checking…") : "None yet."}</CardDescription>
          )}
        </Card>
      </div>

      {registered && <AutoTxNotice />}
    </div>
  );
}
