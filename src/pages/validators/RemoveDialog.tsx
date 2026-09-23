import { useEffect, useRef, useState } from "react";
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

/** The slashing-protection export returned by the keymanager. */
interface Export {
  file: string;
  data: string;
  /**
   * Whether the last download attempt went through without an error. A
   * browser can still block a download silently, so even `true` is only
   * "should be in your downloads", never "saved".
   */
  handedOver: boolean;
}

type Phase =
  | { step: "confirm" }
  | { step: "busy" }
  | { step: "done"; note?: string }
  | { step: "error"; message: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Hand the file to the browser; false when that threw. */
function tryDownload(file: string, data: string): boolean {
  try {
    downloadText(file, data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a validator key through the keymanager. The response carries the
 * key's slashing-protection history, which is offered as
 * `slashing-protection-<pk8>.json` before the dialog reports success. The
 * done step keeps "Download again" available and only closes when the owner
 * closes it.
 */
export function RemoveDialog({ row, onClose, onRemoved }: RemoveDialogProps) {
  const { keymanager } = useApi();
  const [phase, setPhase] = useState<Phase>({ step: "confirm" });
  const [exported, setExported] = useState<Export | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    setPhase({ step: "confirm" });
    setExported(null);
    inFlight.current = false;
  }, [row?.pubkey]);

  if (!row) return null;
  const name = validatorName(row);
  const busy = phase.step === "busy";

  const remove = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase({ step: "busy" });
    let res;
    try {
      res = await keymanager.deleteKeystores([row.pubkey]);
    } catch (e) {
      inFlight.current = false;
      setPhase({ step: "error", message: `The key was not removed: ${errorText(e)}` });
      return;
    }
    // Offer the slashing protection first, whatever the status says.
    if (res.slashing_protection) {
      const file = slashingProtectionFileName(row.pubkey);
      setExported({ file, data: res.slashing_protection, handedOver: tryDownload(file, res.slashing_protection) });
    }
    inFlight.current = false;
    const result = res.data[0];
    if (result?.status === "deleted" || result?.status === "not_active") {
      setPhase({ step: "done" });
      onRemoved();
    } else if (result?.status === "not_found") {
      setPhase({ step: "done", note: "This key was already gone from the node." });
      onRemoved();
    } else {
      setPhase({ step: "error", message: `The key was not removed: ${result?.message || "the keymanager reported an error"}.` });
    }
  };

  const downloadAgain = () => {
    if (exported) setExported({ ...exported, handedOver: tryDownload(exported.file, exported.data) });
  };

  if (phase.step === "done") {
    const failed = !!exported && !exported.handedOver;
    return (
      <Modal
        open
        // Escape and the close button stay off while the file couldn't be offered.
        onClose={failed ? undefined : onClose}
        closeOnBackdrop={false}
        title={`${name} removed`}
        footer={
          exported ? (
            failed ? (
              <>
                <Button variant="ghost" onClick={onClose} className="mr-auto">
                  Close without the file
                </Button>
                <Button onClick={downloadAgain}>Download again</Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={downloadAgain} className="mr-auto">
                  Download again
                </Button>
                <Button onClick={onClose}>I have the file</Button>
              </>
            )
          ) : (
            <Button onClick={onClose}>Done</Button>
          )
        }
      >
        <div className="flex flex-col gap-3 text-sm text-fg-muted">
          {phase.note && <p>{phase.note}</p>}
          {!exported ? (
            <p className="text-warning-text">The node didn't return a slashing-protection file for this key.</p>
          ) : failed ? (
            <p role="alert" className="rounded-lg border border-warning/30 bg-warning-subtle p-3 text-warning-text">
              <strong className="font-semibold">Your browser didn't save the slashing-protection file.</strong> Download
              it now, before you close this. It is the only copy of this validator's signing history.
            </p>
          ) : (
            <p>
              Your browser should have saved its slashing-protection file as{" "}
              <span className="break-all font-mono text-fg">{exported.file}</span>. If you don't see it in your
              downloads, use Download again.
            </p>
          )}
          {exported && <p>Keep the file: import it together with the key if you run this validator on another machine.</p>}
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
          {phase.step === "error" && exported && (
            <Button variant="secondary" onClick={downloadAgain} className="mr-auto">
              Download again
            </Button>
          )}
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
