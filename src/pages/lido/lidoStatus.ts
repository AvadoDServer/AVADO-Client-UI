/**
 * Which validators on this node are Lido CSM validators, and which of them
 * need attention. Pure, so the page, the validator list and the tests agree.
 */
import type { Network } from "../../config/clientConfig";
import { isLidoCredentials, isLidoFeeRecipient } from "../../lib/lido";
import { feeRecipientInfo } from "../validators/statusText";
import type { ValidatorRowData } from "../validators/useValidators";

/** The address this key's block rewards go to: the override, else the default; null when none or unknown. */
export function effectiveFeeRecipient(row: ValidatorRowData, defaultFeeRecipient: string): string | null {
  const info = feeRecipientInfo(row.feeRecipient, defaultFeeRecipient);
  return info.kind === "default" || info.kind === "custom" ? (info.address ?? null) : null;
}

/** The beacon chain says this key pays out to Lido (0x01/0x02 credentials to Lido's withdrawal vault). */
export const hasLidoCredentials = (row: ValidatorRowData, network: Network): boolean =>
  !!row.state && isLidoCredentials(row.state.validator.withdrawal_credentials, network);

/**
 * A Lido validator: its withdrawals go to Lido, or the beacon chain doesn't
 * know it yet (or didn't answer) and it already sends its block rewards to
 * Lido.
 */
export function isLidoRow(row: ValidatorRowData, network: Network, defaultFeeRecipient: string): boolean {
  if (row.state) return hasLidoCredentials(row, network);
  return isLidoFeeRecipient(effectiveFeeRecipient(row, defaultFeeRecipient), network);
}

export interface LidoSummary {
  /** Every Lido validator on this node. */
  lido: ValidatorRowData[];
  /** Lido validators whose block rewards go somewhere else: Lido fines that. */
  wrongFee: ValidatorRowData[];
  /** Lido validators whose fee recipient the client didn't report. */
  feeUnknown: ValidatorRowData[];
  /** Validators that are not Lido's but send their block rewards to Lido. */
  givingAway: ValidatorRowData[];
  /** The default fee recipient (Settings) is Lido's address. */
  defaultIsLido: boolean;
}

export function summariseLido(rows: ValidatorRowData[], network: Network, defaultFeeRecipient: string): LidoSummary {
  const lido: ValidatorRowData[] = [];
  const wrongFee: ValidatorRowData[] = [];
  const feeUnknown: ValidatorRowData[] = [];
  const givingAway: ValidatorRowData[] = [];
  for (const row of rows) {
    const fee = effectiveFeeRecipient(row, defaultFeeRecipient);
    if (isLidoRow(row, network, defaultFeeRecipient)) {
      lido.push(row);
      if (row.feeRecipient === undefined) feeUnknown.push(row);
      else if (!isLidoFeeRecipient(fee, network)) wrongFee.push(row);
    } else if (row.state && isLidoFeeRecipient(fee, network)) {
      givingAway.push(row);
    }
  }
  return { lido, wrongFee, feeUnknown, givingAway, defaultIsLido: isLidoFeeRecipient(defaultFeeRecipient, network) };
}

/** "1 validator" / "3 validators" */
export const validators = (n: number): string => `${n} validator${n === 1 ? "" : "s"}`;

/** Lido notes in the validator dialogs, next to Rocket Pool's. */
export const LIDO_TEXT = {
  fee: "This is a Lido CSM validator. Its block rewards must go to Lido's address below. Any other address costs a penalty from your bond.",
  exit: "This is a Lido CSM validator. After the exit, the 32 ETH goes back to Lido. You get your bond back in Lido's CSM app once the validator shows as Withdrawn there.",
} as const;
