import { useState } from "react";
import type { NodeStatus } from "../../api/models";
import { reconcileStatusOf } from "../../api/reconcile";
import { AutoTxNotice, Notice } from "../../components/common";
import { useMegapoolStatus } from "../../data/nodeReads";
import { useAppStatus } from "../../status/AppStatus";
import { DepositFlow, NewValidatorsForm, plural, type DepositPlan } from "../deposit/NewValidators";

/** Step 6: the first megapool validators, with the shared deposit form and flow. */
export function ValidatorsStep({ node, onChanged }: { node?: NodeStatus; onChanged: () => void }) {
  const { reconcile } = useAppStatus();
  const registered = !!node?.registered;
  const mega = useMegapoolStatus(registered);
  const [plan, setPlan] = useState<DepositPlan | null>(null);
  const [created, setCreated] = useState<number | null>(null);
  const client = reconcileStatusOf(reconcile)?.client ?? null;

  if (!node) {
    return (
      <Notice tone="neutral" title="Reading your node…">
        <p>This fills in once Rocket Pool answers.</p>
      </Notice>
    );
  }

  // megapool/status answers for a node without a megapool too (not deployed, nothing bonded).
  const megapool = mega.data ? (mega.data.megapoolDetails ?? null) : undefined;

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

      <NewValidatorsForm node={node} megapool={megapool} onReview={setPlan} />

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
        <DepositFlow
          plan={plan}
          open
          onClose={() => setPlan(null)}
          onDone={(count) => {
            setCreated(count);
            void mega.refresh();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

export default ValidatorsStep;
