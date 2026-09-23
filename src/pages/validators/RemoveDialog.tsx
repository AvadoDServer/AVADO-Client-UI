import { useEffect, useState } from "react";
import { useApi } from "../../api/ApiProvider";
import { Button, Modal } from "../../components/ui";
import { downloadText } from "../../lib/download";
import type { ValidatorRowData } from "./useValidators";
import { validatorName } from "./parts";
import { canExit, slashingProtectionFileName } from "./statusText";

export interface RemoveDialogProps {
  /** The validator to remove; the dialog is closed when null. */
  row: ValidatorRowData | null;
  onClose: () => void;
  /** Called once the key is gone, to refresh the list. */
  onRemoved: () => void;
}

type Phase =
  | { step: "confirm" }
  | { step: "busy" }
  | { step: "done"; file?: string; data?: string; note?: string }
  | { step: "error"; message: string; file?: string; data?: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Remove a validator key through the keymanager. The response carries the
 * key's slashing-protection history, which is saved as
 * `slashing-protection-<pk8>.json` before the dialog reports success.
 */
export function RemoveDialog({ row, onClose, onRemoved }: RemoveDialogProps) {
  const { keymanager } = useApi();
  const [phase, setPhase] = useState<Phase>({ step: "confirm" });

  useEffect(() => {
    setPhase({ step: "confirm" });
  }, [row?.pubkey]);

  if (!row) return null;
  const name = validatorName(row);
  const busy = phase.step === "busy";

  const remove = async () => {
    setPhase({ step: "busy" });
    let res;
    try {
      res = await keymanager.deleteKeystores([row.pubkey]);
    } catch (e) {
      setPhase({ step: "error", message: `The key was not removed: ${errorText(e)}` });
      return;
    }
    // Save the slashing protection first, whatever the status says.
    let file: string | undefined;
    const data = res.slashing_protection || undefined;
    if (data) {
      file = slashingProtectionFileName(row.pubkey);
      try {
        downloadText(file, data);
      } catch {
        // The "Download again" button below still offers it.
      }
    }
    const result = res.data[0];
    if (result?.status === "deleted" || result?.status === "not_active") {
      setPhase({ step: "done", file, data });
      onRemoved();
    } else if (result?.status === "not_found") {
      setPhase({ step: "done", file, data, note: "This key was already gone from the node." });
      onRemoved();
    } else {
      setPhase({
        step: "error",
        message: `The key was not removed: ${result?.message || "the keymanager reported an error"}.`,
        file,
        data,
      });
    }
  };

  const downloadAgain = (file?: string, data?: string) =>
    file && data ? (
      <Button variant="secondary" onClick={() => downloadText(file, data)} className="mr-auto">
        Download again
      </Button>
    ) : null;

  if (phase.step === "done") {
    return (
      <Modal
        open
        onClose={onClose}
        title={`${name} removed`}
        footer={
          <>
            {downloadAgain(phase.file, phase.data)}
            <Button onClick={onClose}>Done</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-fg-muted">
          {phase.note && <p>{phase.note}</p>}
          {phase.file ? (
            <p>
              Its slashing-protection file was saved to your downloads as{" "}
              <span className="break-all font-mono text-fg">{phase.file}</span>. Keep it: import it together with the key
              if you run this validator on another machine.
            </p>
          ) : (
            <p className="text-warning-text">The node didn't return a slashing-protection file for this key.</p>
          )}
          <p>Wait at least 15 minutes before you start this validator anywhere else.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      closeOnBackdrop={!busy}
      title={`Remove ${name}?`}
      footer={
        <>
          {phase.step === "error" && downloadAgain(phase.file, phase.data)}
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void remove()} loading={busy}>
            {phase.step === "error" ? "Try again" : "Remove validator"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-fg-muted">
        <p>
          The key is deleted from this node and the validator stops validating here. This does not exit the validator.
        </p>
        {canExit(row.state) && (
          <p>It is active: until you run it somewhere else, it misses rewards and loses a little balance each day.</p>
        )}
        <p>
          Make sure you have a backup of the keystore file or your recovery phrase. Your browser downloads the
          slashing-protection file automatically; keep it.
        </p>
        <p className="break-all font-mono text-xs">{row.pubkey}</p>
        {phase.step === "error" && (
          <p role="alert" className="text-danger-text">
            {phase.message}
          </p>
        )}
      </div>
    </Modal>
  );
}

export default RemoveDialog;
