/**
 * Pure helpers for the Settings form: reading a `Settings` object into form
 * state, diffing form state back into a save patch, and validation. Kept
 * framework-free so they're easy to unit test without rendering.
 */
import type { Settings } from "../../api/types";
import { findExecutionClient } from "../../config/executionClients";

export interface SettingsFormState {
  feeRecipient: string;
  graffiti: string;
  executionEngine: string;
  mevBoost: boolean;
  peerLimit: string;
  checkpointUrl: string;
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

/** Old files may lack any of these fields; missing ones read as their neutral form value. */
export function toFormState(settings: Settings): SettingsFormState {
  const peerLimit = settings.p2p_peer_upper_bound;
  return {
    feeRecipient: str(settings.validators_proposer_default_fee_recipient),
    graffiti: str(settings.validators_graffiti),
    executionEngine: str(settings.execution_engine),
    mevBoost: settings.mev_boost === true,
    peerLimit: typeof peerLimit === "number" && Number.isFinite(peerLimit) ? String(peerLimit) : str(peerLimit),
    checkpointUrl: str(settings.initial_state),
  };
}

/**
 * Only the fields that differ from `baseline`, typed and ready to merge into
 * a save. Picking the execution engine always writes both `execution_engine`
 * and `ee_endpoint` together, like the original wizard's `applyChanges`.
 */
export function buildPatch(form: SettingsFormState, baseline: SettingsFormState): Settings {
  const patch: Settings = {};
  if (form.feeRecipient !== baseline.feeRecipient) patch.validators_proposer_default_fee_recipient = form.feeRecipient;
  if (form.graffiti !== baseline.graffiti) patch.validators_graffiti = form.graffiti;
  if (form.executionEngine !== baseline.executionEngine) {
    patch.execution_engine = form.executionEngine;
    patch.ee_endpoint = findExecutionClient(form.executionEngine)?.eeEndpoint ?? "";
  }
  if (form.mevBoost !== baseline.mevBoost) patch.mev_boost = form.mevBoost;
  if (form.peerLimit !== baseline.peerLimit) patch.p2p_peer_upper_bound = Number(form.peerLimit);
  if (form.checkpointUrl !== baseline.checkpointUrl) patch.initial_state = form.checkpointUrl;
  return patch;
}

export const FEE_RECIPIENT_RE = /^0x[a-fA-F0-9]{40}$/;
export const GRAFFITI_MAX_BYTES = 32;

/** UTF-8 byte length, not character length — an emoji or accented letter costs more than one byte. */
export function graffitiByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function isPositiveInteger(value: string): boolean {
  const v = value.trim();
  return /^[0-9]+$/.test(v) && Number(v) > 0;
}

export function isValidCheckpointUrl(value: string): boolean {
  const v = value.trim();
  if (v === "") return true; // optional
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export interface SettingsFormErrors {
  feeRecipient?: string;
  graffiti?: string;
  peerLimit?: string;
  checkpointUrl?: string;
}

/**
 * Validation is keyed off whether a field was actually edited (differs from
 * `baseline`), not off which mode currently renders it:
 *
 *  - Fee recipient and graffiti are always on-screen, so they're always
 *    validated. An old file with the fee recipient still blank (as shipped
 *    in defaultsettings-mainnet.json) keeps blocking Save until it's set —
 *    a deliberate, previously-ruled decision: an owner who only wants to
 *    change something else must still supply one.
 *  - Peer limit and checkpoint URL are Advanced-only. An old settings.json
 *    missing one reads as `""` (see `toFormState`) and must not block Save
 *    until the owner actually edits it — an untouched, missing field shows
 *    the default as a hint only and is never written. Comparing against
 *    `baseline` instead of gating on the *current* mode also closes the gap
 *    where switching from Advanced to Simple mid-edit used to make an
 *    invalid value invisible but still patchable: `SettingsPage` resets
 *    these two fields back to `baseline` the moment Advanced mode is left,
 *    so by the time they're compared here they can only differ from
 *    `baseline` while they're on-screen and were genuinely just edited.
 */
export function validateForm(form: SettingsFormState, baseline: SettingsFormState): SettingsFormErrors {
  const errors: SettingsFormErrors = {};

  if (form.feeRecipient.trim() === "") {
    errors.feeRecipient = "Enter a default fee recipient.";
  } else if (!FEE_RECIPIENT_RE.test(form.feeRecipient)) {
    errors.feeRecipient = "Enter a valid address: 0x followed by 40 hex characters.";
  }

  const bytes = graffitiByteLength(form.graffiti);
  if (bytes > GRAFFITI_MAX_BYTES) {
    errors.graffiti = `Graffiti is ${bytes} bytes; the limit is ${GRAFFITI_MAX_BYTES} bytes.`;
  }

  if (form.peerLimit !== baseline.peerLimit && !isPositiveInteger(form.peerLimit)) {
    errors.peerLimit = "Enter a positive whole number.";
  }
  if (form.checkpointUrl !== baseline.checkpointUrl && !isValidCheckpointUrl(form.checkpointUrl)) {
    errors.checkpointUrl = "Enter a valid URL.";
  }

  return errors;
}
