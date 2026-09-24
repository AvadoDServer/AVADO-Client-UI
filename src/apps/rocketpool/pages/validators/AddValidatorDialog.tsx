import { useState } from "react";
import { Button, Modal } from "../../../../components/ui";
import type { MegapoolDetails, NodeStatus } from "../../api/models";
import { DepositFlow, NewValidatorsForm, type DepositPlan } from "../deposit/NewValidators";

/**
 * Add megapool validators from the Validators page: the same form and
 * deposit flow as the setup wizard's last step (`deposit/NewValidators`).
 * The dialog gives way to the transaction flow once the owner reviews.
 */
export function AddValidatorDialog({
  node,
  megapool,
  onClose,
  onDone,
}: {
  node: NodeStatus;
  /** undefined while it loads; null before the first validator (the first deposit creates the megapool). */
  megapool: MegapoolDetails | null | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const [plan, setPlan] = useState<DepositPlan | null>(null);

  if (plan) return <DepositFlow plan={plan} open onClose={onClose} onDone={onDone} />;

  return (
    <Modal
      open
      onClose={onClose}
      title="Add validators"
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-fg-muted">
          Each megapool validator needs a bond from you; Rocket Pool adds the rest of its 32 ETH. RPL is optional. New validators wait in
          Rocket Pool's queue and your node starts them automatically.
        </p>
        <NewValidatorsForm node={node} megapool={megapool} onReview={setPlan} />
      </div>
    </Modal>
  );
}
