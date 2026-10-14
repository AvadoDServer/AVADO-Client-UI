import { Link } from "react-router-dom";
import { Card, CardDescription, CardTitle, StatusPill } from "../../../../components/ui";
import { plainError } from "../../api/errors";
import { readStakingInfo, readWallet } from "../../api/node";
import { useRead } from "../../api/useRead";
import { BackupButton } from "../../components/BackupButton";
import { Facts, LoadingLines, Notice, TechDetails } from "../../components/common";
import { formatAgo, formatCount, formatQtum } from "../../lib/format";
import { useAppStatus } from "../../status/AppStatus";
import { stakingView } from "../../status/staking";

/** How often Home re-reads the rewards: they come days apart, and the monitor recomputes only after a new wallet transaction. */
export const SUMMARY_READ_MS = 5 * 60_000;

function CardLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="text-sm font-semibold text-accent underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}

/** "Back up your wallet": shown until a backup has been downloaded once. */
export function BackupCallout() {
  return (
    <Card as="section" aria-label="Back up your wallet" className="flex flex-col gap-3 border border-warning/40" data-testid="backup-callout">
      <div>
        <CardTitle>Back up your wallet</CardTitle>
        <CardDescription>
          Your wallet holds the keys to your coins. Download a backup now and keep it somewhere safe, for example on a USB stick. This message goes away once
          you have downloaded one.
        </CardDescription>
      </div>
      <BackupButton />
    </Card>
  );
}

/** Home (spec): the node, the wallet, staking and rewards at a glance. */
export default function HomePage() {
  const { walletStatus, walletReady, node, nodeError, backupRequired } = useAppStatus();
  const nodeUp = !!node && nodeError === undefined;
  const canRead = walletReady && nodeUp;
  const wallet = useRead(readWallet, { enabled: canRead });
  const staking = useRead(readStakingInfo, { enabled: nodeUp });
  const summary = useRead((api) => api.stakingSummary(), { enabled: canRead, intervalMs: SUMMARY_READ_MS });
  const view = stakingView({ walletStatus, node, wallet: wallet.data, staking: staking.data });
  const w = wallet.data;
  const s = summary.data;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-4xl font-bold tracking-tight text-fg">Home</h1>

      {backupRequired && <BackupCallout />}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
        <Card as="section" aria-labelledby="wallet-title" className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <CardTitle id="wallet-title">Wallet</CardTitle>
            <CardLink to="/wallet">Addresses and backup</CardLink>
          </div>
          {w ? (
            <Facts
              testId="wallet-facts"
              rows={[
                ["Balance", formatQtum(w.total)],
                ["Available", formatQtum(w.available)],
                ...(w.inStake > 0 ? ([["In a recent stake", formatQtum(w.inStake)]] as Array<[string, string]>) : []),
                ...(w.immature > 0 ? ([["Not spendable yet", formatQtum(w.immature)]] as Array<[string, string]>) : []),
                ...(w.pending > 0 ? ([["Waiting for confirmation", formatQtum(w.pending)]] as Array<[string, string]>) : []),
                ["Password", !w.encrypted ? "None" : w.unlocked ? "Unlocked for staking" : "Locked"],
              ]}
            />
          ) : canRead && wallet.error === undefined ? (
            <LoadingLines />
          ) : (
            <CardDescription>{canRead ? `Could not read your wallet. ${plainError(wallet.error)}` : "Shows here once your wallet is ready."}</CardDescription>
          )}
          {w && node?.syncing && (
            <CardDescription data-testid="balance-syncing">
              The balance may be incomplete until the node has caught up with the network.
            </CardDescription>
          )}
          {w && w.inStake > 0 && (
            <CardDescription>Coins in a recent stake come back, with the reward, after 500 blocks (about four and a half hours).</CardDescription>
          )}
          <TechDetails error={wallet.error} />
        </Card>

        <Card as="section" aria-labelledby="staking-title" className="flex flex-col gap-3">
          <CardTitle id="staking-title">Staking</CardTitle>
          <div data-testid="staking-state">
            <StatusPill status={view} />
          </div>
          <p className="text-sm text-fg" data-testid="staking-reason">
            {view.text}
          </p>
          {view.expected && (
            <Facts testId="staking-facts" rows={[["Next reward expected in", view.expected]]} />
          )}
          {view.reason === "locked" && (
            <div>
              <CardLink to="/wallet">Unlock for staking</CardLink>
            </div>
          )}
        </Card>

        <Card as="section" aria-labelledby="rewards-title" className="flex flex-col gap-3 lg:col-span-2">
          <CardTitle id="rewards-title">Rewards</CardTitle>
          {s ? (
            <>
              <Facts
                testId="rewards-facts"
                rows={[
                  ["Total earned", formatQtum(s.totalRewards)],
                  ["Last 30 days", formatQtum(s.rewards30d)],
                  ["Rewards in the last 30 days", formatCount(s.count)],
                  ["Rewards in total", formatCount(s.countAll)],
                  ["Last reward", s.lastRewardAt ? formatAgo(s.lastRewardAt) : "None yet"],
                ]}
              />
              {s.truncated && <CardDescription>Your wallet has a very long history; only the most recent part of it is counted here.</CardDescription>}
            </>
          ) : canRead && summary.error === undefined ? (
            <LoadingLines />
          ) : (
            <CardDescription>
              {canRead ? `Could not read your rewards. ${plainError(summary.error)}` : "Shows here once your wallet is ready."}
            </CardDescription>
          )}
          <TechDetails error={summary.error} />
        </Card>
      </div>

      {walletStatus?.state === "ready" && w && w.total === 0 && !backupRequired && (
        <Notice tone="neutral" title="Start staking">
          <p>Send QTUM to one of your addresses on the Wallet page. Coins start staking about four and a half hours after they arrive.</p>
        </Notice>
      )}
    </div>
  );
}
