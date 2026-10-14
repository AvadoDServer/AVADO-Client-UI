import type { QtumSettings, SettingsPatch } from "../../api/models";

export interface DelegationForm {
  fee: string;
  min: string;
}

export const formFrom = (s: QtumSettings): DelegationForm => ({ fee: String(s.DELEGATION_FEE_PERCENT), min: String(s.MIN_DELEGATION_AMOUNT) });

/** The monitor's own rules, checked before sending: a whole percent 0–100, and an amount of 0 or more. */
export function validate(form: DelegationForm): { fee?: string; min?: string } {
  const errors: { fee?: string; min?: string } = {};
  const fee = Number(form.fee);
  if (form.fee.trim() === "" || !Number.isInteger(fee) || fee < 0 || fee > 100) errors.fee = "The delegation fee must be a whole number from 0 to 100.";
  const min = Number(form.min);
  if (form.min.trim() === "" || !Number.isFinite(min) || min < 0) errors.min = "The minimum delegation amount must be a number of 0 or more.";
  return errors;
}

/** Only what changed (the node restarts when one of them does). */
export function changes(form: DelegationForm, saved: QtumSettings): SettingsPatch {
  const patch: SettingsPatch = {};
  const fee = Number(form.fee);
  const min = Number(form.min);
  if (fee !== saved.DELEGATION_FEE_PERCENT) patch.DELEGATION_FEE_PERCENT = fee;
  if (min !== saved.MIN_DELEGATION_AMOUNT) patch.MIN_DELEGATION_AMOUNT = min;
  return patch;
}
