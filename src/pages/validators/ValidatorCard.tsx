import type { ReactNode } from "react";
import { Card } from "../../components/ui";
import {
  ValidatorActions,
  ValidatorBalance,
  ValidatorFeeRecipient,
  ValidatorIdentity,
  ValidatorStatus,
  ValidatorWithdrawal,
  type ValidatorItemProps,
} from "./parts";
import { validatorStatusText } from "./statusText";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs font-semibold text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/** One validator on a phone (and narrow windows). */
export function ValidatorCard({ row, network, defaultFeeRecipient, onAction }: ValidatorItemProps) {
  const status = validatorStatusText(row.state);
  return (
    <Card as="li" padding="sm" data-pubkey={row.pubkey} className="min-w-0">
      <div className="flex items-start justify-between gap-3">
        <ValidatorIdentity row={row} network={network} />
        <ValidatorStatus row={row} />
      </div>
      {!row.state && <p className="mt-2 text-xs text-fg-muted">{status.detail}</p>}
      <dl className="mt-4 grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
        <Field label="Balance">
          <ValidatorBalance row={row} network={network} />
        </Field>
        <Field label="Withdrawals">
          <ValidatorWithdrawal row={row} />
        </Field>
        <Field label="Fee recipient">
          <ValidatorFeeRecipient row={row} defaultFeeRecipient={defaultFeeRecipient} />
        </Field>
      </dl>
      <ValidatorActions row={row} onAction={onAction} className="-mx-2 mt-3 border-t border-border pt-2" />
    </Card>
  );
}

export default ValidatorCard;
