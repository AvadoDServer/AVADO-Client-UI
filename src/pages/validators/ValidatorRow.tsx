import { TD, TR } from "../../components/ui";
import {
  ValidatorActions,
  ValidatorBalance,
  ValidatorFeeRecipient,
  ValidatorIdentity,
  ValidatorStatus,
  ValidatorWithdrawal,
  type ValidatorItemProps,
} from "./parts";

/** One validator in the desktop table. */
export function ValidatorRow({ row, network, defaultFeeRecipient, onAction }: ValidatorItemProps) {
  return (
    <TR data-pubkey={row.pubkey}>
      <TD>
        <ValidatorIdentity row={row} network={network} />
      </TD>
      <TD>
        <ValidatorStatus row={row} />
      </TD>
      <TD>
        <ValidatorBalance row={row} network={network} />
      </TD>
      <TD>
        <ValidatorFeeRecipient row={row} defaultFeeRecipient={defaultFeeRecipient} />
      </TD>
      <TD>
        <ValidatorWithdrawal row={row} />
      </TD>
      <TD align="right">
        <ValidatorActions row={row} onAction={onAction} nowrap className="justify-end" />
      </TD>
    </TR>
  );
}

export default ValidatorRow;
