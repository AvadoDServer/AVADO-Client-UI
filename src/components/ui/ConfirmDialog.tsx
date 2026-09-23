import { useEffect, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { Input } from "./Input";
import { Modal } from "./Modal";

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  /** Body text or content explaining what happens. */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" for destructive actions (the default), "primary" otherwise. */
  tone?: "danger" | "primary";
  /** Shows a spinner on the confirm button and blocks closing. */
  loading?: boolean;
  /**
   * When set, the owner must type this exact text before the confirm button
   * enables (used for irreversible actions such as a voluntary exit).
   */
  requireText?: string;
  requireTextLabel?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * ConfirmDialog — a declarative confirm built on Modal, with the Admin's
 * look (pill Cancel + pill confirm). Cancel always comes first.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  loading = false,
  requireText,
  requireTextLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const blocked = requireText !== undefined && typed.trim() !== requireText;
  const close = loading ? undefined : onCancel;

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      size="md"
      closeOnBackdrop={!loading}
      footer={
        <>
          <Button variant="secondary" pill onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone} pill onClick={onConfirm} loading={loading} disabled={blocked}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children && <div className="whitespace-pre-line text-sm text-fg-muted">{children}</div>}
      {requireText !== undefined && (
        <Input
          className="mt-4"
          label={requireTextLabel ?? <>Type {requireText} to confirm</>}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      )}
    </Modal>
  );
}

export default ConfirmDialog;
