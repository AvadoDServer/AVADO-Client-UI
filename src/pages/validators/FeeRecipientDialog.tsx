import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../../api/ApiProvider";
import { Button, Input, Modal } from "../../components/ui";
import type { ValidatorRowData } from "./useValidators";
import { validatorName } from "./parts";
import { FEE_RECIPIENT_RE, feeRecipientInfo, sameAddress } from "./statusText";

export interface FeeRecipientDialogProps {
  /** The validator being edited; the dialog is closed when null. */
  row: ValidatorRowData | null;
  defaultFeeRecipient: string;
  onClose: () => void;
  /** Called after a successful change, to refresh the list. */
  onChanged: () => void;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Set or clear a per-validator fee-recipient override through the
 * keymanager. An empty field (or the default address) clears the override,
 * so the validator follows the default from Settings.
 */
export function FeeRecipientDialog({ row, defaultFeeRecipient, onClose, onChanged }: FeeRecipientDialogProps) {
  const { keymanager } = useApi();
  const info = row ? feeRecipientInfo(row.feeRecipient, defaultFeeRecipient) : null;
  const hasOverride = info?.kind === "custom";
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(hasOverride ? (info?.address ?? "") : "");
    setError(null);
    setBusy(false);
    // Reset only when another validator is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.pubkey]);

  if (!row) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setBusy(false);
      onChanged();
      onClose();
    } catch (e) {
      setBusy(false);
      setError(`That didn't work: ${errorText(e)}`);
    }
  };

  const clearOverride = () => run(() => keymanager.deleteFeeRecipient(row.pubkey));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (v === "" || sameAddress(v, defaultFeeRecipient)) {
      if (!hasOverride) {
        onClose();
        return;
      }
      void clearOverride();
      return;
    }
    if (!FEE_RECIPIENT_RE.test(v)) {
      setError("Enter an Ethereum address: 0x followed by 40 characters 0-9 and a-f.");
      return;
    }
    void run(() => keymanager.setFeeRecipient(row.pubkey, v));
  };

  const formId = `fee-recipient-${row.pubkey.slice(2, 10)}`;

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      closeOnBackdrop={!busy}
      title="Fee recipient"
      description={`${validatorName(row)} sends its block rewards (tips and MEV) to this address.`}
      footer={
        <>
          {hasOverride && (
            <Button variant="ghost" onClick={() => void clearOverride()} disabled={busy} className="mr-auto">
              Use the default
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Input
          label="Address for this validator"
          placeholder={defaultFeeRecipient || "0x…"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={error ?? undefined}
          hint={
            defaultFeeRecipient ? (
              <>
                Leave empty to use the default: <span className="break-all font-mono">{defaultFeeRecipient}</span>
              </>
            ) : (
              <>
                No default fee recipient is set yet. <Link to="/settings?focus=fee-recipient">Set one in Settings</Link> so every validator has
                one.
              </>
            )
          }
          autoComplete="off"
          spellCheck={false}
          className="[&_input]:font-mono"
        />
      </form>
    </Modal>
  );
}

export default FeeRecipientDialog;
