import { useEffect, useState, type FormEvent } from "react";
import { useApi } from "../../api/ApiProvider";
import { Button, Input, Modal } from "../../components/ui";
import type { ValidatorRowData } from "./useValidators";
import { withdrawalText } from "./statusText";

export interface ExitDialogProps {
  /** The validator to exit; the dialog is closed when null. */
  row: ValidatorRowData | null;
  onClose: () => void;
  /** Called after the beacon node accepted the exit, to refresh the list. */
  onSubmitted: () => void;
}

type Phase = { step: "confirm" } | { step: "busy" } | { step: "done" } | { step: "error"; message: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />
    </svg>
  );
}

/**
 * Voluntary exit: the owner types the validator index to confirm, then the
 * keymanager signs the exit and the beacon node broadcasts it.
 */
export function ExitDialog({ row, onClose, onSubmitted }: ExitDialogProps) {
  const { keymanager, beacon } = useApi();
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<Phase>({ step: "confirm" });

  useEffect(() => {
    setTyped("");
    setPhase({ step: "confirm" });
  }, [row?.pubkey]);

  if (!row || !row.state) return null;
  const index = row.state.index;
  const withdrawal = withdrawalText(row.state.validator.withdrawal_credentials);
  const busy = phase.step === "busy";
  const matches = typed.trim() === index;

  const exit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!matches || busy) return;
    setPhase({ step: "busy" });
    let signed;
    try {
      signed = await keymanager.signVoluntaryExit(row.pubkey);
    } catch (err) {
      setPhase({ step: "error", message: `The exit message could not be signed: ${errorText(err)}` });
      return;
    }
    if (signed.message.validator_index !== index) {
      setPhase({
        step: "error",
        message: `The signed exit is for validator ${signed.message.validator_index}, not ${index}. Nothing was sent.`,
      });
      return;
    }
    try {
      await beacon.submitVoluntaryExit(signed);
    } catch (err) {
      setPhase({ step: "error", message: `The beacon node didn't accept the exit: ${errorText(err)}` });
      return;
    }
    setPhase({ step: "done" });
    onSubmitted();
  };

  if (phase.step === "done") {
    return (
      <Modal open onClose={onClose} title={`Exit submitted for validator ${index}`} footer={<Button onClick={onClose}>Done</Button>}>
        <div className="flex flex-col gap-3 text-sm text-fg-muted">
          <p>The beacon chain has the exit request. The status changes to Exiting within a few minutes.</p>
          <p>Keep this node running until the status says Exited. That can take from a day to several weeks.</p>
        </div>
      </Modal>
    );
  }

  const formId = `exit-${index}`;

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      closeOnBackdrop={!busy}
      title={`Exit validator ${index}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" type="submit" form={formId} disabled={!matches} loading={busy}>
            Exit validator
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={exit} className="flex flex-col gap-4 text-sm">
        <div role="note" className="flex gap-3 rounded-lg border border-danger/30 bg-danger-subtle p-3 text-danger-text">
          <WarningIcon />
          <p>
            <strong className="font-semibold">An exit is permanent and can't be undone.</strong> This validator stops
            validating for good. To stake again you need a new validator and a new deposit.
          </p>
        </div>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-fg-muted">
          <li>Keep this node running until the status says Exited. That can take from a day to several weeks.</li>
          {withdrawal.kind === "bls" ? (
            <li className="text-warning-text">
              This validator has no withdrawal address yet. After the exit its balance stays locked until you set one.
            </li>
          ) : withdrawal.address ? (
            <li>
              Afterwards the balance is paid to the withdrawal address{" "}
              <span className="break-all font-mono text-fg">{withdrawal.address}</span>.
            </li>
          ) : null}
        </ul>
        <Input
          label={
            <>
              Type the validator index, <span className="font-mono text-fg">{index}</span>, to confirm
            </>
          }
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
        {phase.step === "error" && (
          <p role="alert" className="text-danger-text">
            {phase.message}
          </p>
        )}
      </form>
    </Modal>
  );
}

export default ExitDialog;
