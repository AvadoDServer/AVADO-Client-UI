import { useState } from "react";
import { Button } from "../../../../components/ui";
import { plainError } from "../../api/errors";
import type { NodeStatus } from "../../api/models";
import { Notice } from "../../components/common";
import { useSmoothingPoolStatus } from "../../data/nodeReads";
import { toBigInt } from "../../lib/units";
import { TransactionFlow } from "../../tx/TransactionFlow";

const NS_PER_DAY = 86_400n * 10n ** 9n;

/** "about 3 days" / "about 5 hours" from nanoseconds; null when there is no wait. */
export function waitText(ns: bigint | null): string | null {
  if (ns === null || ns <= 0n) return null;
  if (ns >= NS_PER_DAY) {
    const d = Number((ns + NS_PER_DAY - 1n) / NS_PER_DAY);
    return `about ${d} ${d === 1 ? "day" : "days"}`;
  }
  const h = Math.max(1, Number((ns + 3_600n * 10n ** 9n - 1n) / (3_600n * 10n ** 9n)));
  return `about ${h} ${h === 1 ? "hour" : "hours"}`;
}

/** Step 5 (optional): join or leave the smoothing pool. */
export function SmoothingStep({ node, onChanged }: { node?: NodeStatus; onChanged: () => void }) {
  const sp = useSmoothingPoolStatus(!!node?.registered);
  const [open, setOpen] = useState(false);

  if (!node) {
    return (
      <Notice tone="neutral" title="Reading your node…">
        <p>This fills in once Rocket Pool answers.</p>
      </Notice>
    );
  }
  const inPool = sp.data?.nodeRegistered ?? node.feeRecipientInfo.isInSmoothingPool;
  const wait = waitText(toBigInt(sp.data?.timeLeftUntilChangeable));
  const join = !inPool;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 text-sm text-fg">
        <p>
          Now and then one of your validators gets to add a block to Ethereum and earns the tips paid for it (block rewards). The{" "}
          <strong>smoothing pool</strong> collects these from all its members and shares them out, so instead of a rare big payout you
          get a steady share, paid with Rocket Pool's rewards every 28 days.
        </p>
        <p>
          It is a choice, not a requirement. Most small operators prefer the steady share. After you join or leave, you have to wait a
          full rewards period before you can change it again.
        </p>
        <p>Your AVADO sends your block rewards to the right place by itself, whichever you choose.</p>
      </div>

      <Notice tone={inPool ? "success" : "neutral"} title={inPool ? "Your node is in the smoothing pool" : "Your node is not in the smoothing pool"} testId="smoothing-state">
        {node.feeRecipientInfo.isInOptOutCooldown && <p>You left recently: until that takes full effect, rewards still go to the smoothing pool.</p>}
        {wait && <p>You can change this again in {wait}.</p>}
        {sp.error !== undefined && !sp.data && <p>Could not check when this can change. {plainError(sp.error)}</p>}
      </Notice>

      <div>
        <Button variant={join ? "primary" : "secondary"} onClick={() => setOpen(true)} disabled={!!wait}>
          {join ? "Join the smoothing pool" : "Leave the smoothing pool"}
        </Button>
      </div>

      <TransactionFlow
        open={open}
        title={join ? "Join the smoothing pool" : "Leave the smoothing pool"}
        summary={
          join
            ? "Your node's block rewards go to the smoothing pool, and you get a steady share of everyone's, paid every 28 days."
            : "Your node keeps its own block rewards again, after the current 28-day period. You won't get a share of the smoothing pool after that."
        }
        tx={{ canRoute: "node/can-set-smoothing-pool-status", route: "node/set-smoothing-pool-status", params: { status: join ? "true" : "false" } }}
        confirmLabel={join ? "Join" : "Leave"}
        onClose={() => setOpen(false)}
        onDone={() => {
          void sp.refresh();
          onChanged();
        }}
      />
    </div>
  );
}

export default SmoothingStep;
