/**
 * Pieces shared by the desktop table row and the phone card, so both show
 * the same words.
 */
import { Badge, Button, StatusPill, cn } from "../../components/ui";
import type { Network } from "../../config/clientConfig";
import type { ValidatorRowData } from "./useValidators";
import {
  beaconchainValidatorUrl,
  canExit,
  feeRecipientInfo,
  formatBalance,
  shortHex,
  validatorStatusText,
  withdrawalText,
} from "./statusText";

export type ValidatorAction = "fee" | "remove" | "exit";

export interface ValidatorItemProps {
  row: ValidatorRowData;
  network: Network;
  defaultFeeRecipient: string;
  onAction: (action: ValidatorAction, row: ValidatorRowData) => void;
}

/** "Validator 412345", or "Key 0x8f3a…c21d" before it has an index. */
export function validatorName(row: ValidatorRowData): string {
  return row.state ? `Validator ${row.state.index}` : `Key ${shortHex(row.pubkey)}`;
}

export function ExternalIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-3.5 w-3.5 flex-shrink-0", className)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

/** Index (or "New key") linking to the validator on beaconcha.in, with the short pubkey below. */
export function ValidatorIdentity({ row, network }: Pick<ValidatorItemProps, "row" | "network">) {
  const href = beaconchainValidatorUrl(network, row.pubkey);
  return (
    <div className="flex min-w-0 flex-col">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 font-semibold text-fg hover:text-accent"
        title="Open on beaconcha.in"
      >
        {row.state ? row.state.index : "New key"}
        <ExternalIcon className="text-fg-muted" />
        <span className="sr-only">(opens beaconcha.in in a new tab)</span>
      </a>
      <span className="truncate font-mono text-xs text-fg-muted" title={row.pubkey}>
        {shortHex(row.pubkey, 8, 6)}
      </span>
    </div>
  );
}

export function ValidatorStatus({ row }: { row: ValidatorRowData }) {
  const s = validatorStatusText(row.state);
  return (
    <span title={s.detail}>
      <StatusPill status={{ tone: s.tone, label: s.label }} />
    </span>
  );
}

export function ValidatorBalance({ row, network }: Pick<ValidatorItemProps, "row" | "network">) {
  if (!row.state) return <span className="text-fg-muted">—</span>;
  return (
    <div className="flex flex-col">
      <span className="whitespace-nowrap tabular-nums text-fg">{formatBalance(row.state.balance, network)}</span>
      <span className="whitespace-nowrap text-xs tabular-nums text-fg-muted">
        Effective {formatBalance(row.state.validator.effective_balance, network)}
      </span>
    </div>
  );
}

export function ValidatorFeeRecipient({ row, defaultFeeRecipient }: Pick<ValidatorItemProps, "row" | "defaultFeeRecipient">) {
  const info = feeRecipientInfo(row.feeRecipient, defaultFeeRecipient);
  if (info.kind === "unknown") return <span className="text-fg-muted">{info.label}</span>;
  if (info.kind === "none") {
    return (
      <a href="#/settings" className="text-sm font-medium text-warning-text underline-offset-2 hover:underline">
        Not set · set a default
      </a>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-xs text-fg" title={info.address}>
        {shortHex(info.address ?? "")}
      </span>
      <Badge variant={info.kind === "custom" ? "accent" : "neutral"}>{info.label}</Badge>
    </div>
  );
}

export function ValidatorWithdrawal({ row }: { row: ValidatorRowData }) {
  if (!row.state) return <span className="text-fg-muted">—</span>;
  const w = withdrawalText(row.state.validator.withdrawal_credentials);
  return (
    <div className="flex flex-col gap-0.5" title={w.detail}>
      <StatusPill status={{ tone: w.tone, label: w.label }} />
      {w.address && (
        <span className="font-mono text-xs text-fg-muted" title={w.address}>
          {shortHex(w.address)}
          {w.kind === "compounding" ? " · compounding" : ""}
        </span>
      )}
    </div>
  );
}

/** Fee recipient, remove and (when possible) exit. */
export function ValidatorActions({
  row,
  onAction,
  className,
  nowrap = false,
}: Pick<ValidatorItemProps, "row" | "onAction"> & { className?: string; nowrap?: boolean }) {
  const name = validatorName(row);
  return (
    <div className={cn("flex items-center gap-1.5", nowrap ? "flex-nowrap" : "flex-wrap", className)}>
      <Button size="sm" variant="ghost" onClick={() => onAction("fee", row)} aria-label={`Change fee recipient of ${name}`}>
        Fee recipient
      </Button>
      {canExit(row.state) && (
        <Button size="sm" variant="ghost" onClick={() => onAction("exit", row)} aria-label={`Exit ${name}`}>
          Exit
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onAction("remove", row)}
        disabled={row.readonly}
        aria-label={`Remove ${name}`}
        title={row.readonly ? "This key is read-only and can't be removed here" : undefined}
      >
        Remove
      </Button>
    </div>
  );
}
