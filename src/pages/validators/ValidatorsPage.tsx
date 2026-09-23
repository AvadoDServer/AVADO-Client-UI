import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Card, Skeleton, Spinner, Table, TBody, TH, THead, TR } from "../../components/ui";
import { useClientConfig } from "../../config/ClientConfigProvider";
import { clientDisplayName } from "../../lib/clientName";
import { useMode } from "../../settings/ModeProvider";
import { ExitDialog } from "./ExitDialog";
import { FeeRecipientDialog } from "./FeeRecipientDialog";
import { ExternalIcon, type ValidatorAction } from "./parts";
import { RemoveDialog } from "./RemoveDialog";
import { beaconchainDashboardUrl } from "./statusText";
import { useValidators, type ValidatorRowData } from "./useValidators";
import { ValidatorCard } from "./ValidatorCard";
import { ValidatorRow } from "./ValidatorRow";

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

const Header = forwardRef<HTMLHeadingElement, { count?: number; action?: ReactNode }>(function Header({ count, action }, ref) {
  return (
    <header className="mb-6 flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 ref={ref} tabIndex={-1} className="mb-0 font-display text-4xl font-bold tracking-tight text-fg focus:outline-none">
            Validators
          </h1>
          {typeof count === "number" && count > 0 && (
            <span className="rounded-full bg-fg/[0.06] px-2.5 py-0.5 text-sm font-semibold text-fg-muted">{count}</span>
          )}
        </div>
        <p className="mb-0 max-w-2xl text-sm text-fg-muted">The validator keys on this node and what the beacon chain says about them.</p>
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </header>
  );
});

const AddButton = ({ size = "md" }: { size?: "md" | "lg" }) => (
  <Button as="a" href="#/add" size={size} leftIcon={<PlusIcon />}>
    Add validators
  </Button>
);

function LoadingState() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <span className="sr-only">
        <Spinner label="Loading validators" />
      </span>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-16 w-full" rounded="lg" />
      ))}
    </div>
  );
}

function StartingState({ client, message }: { client: string; message: string }) {
  const { isAdvanced } = useMode();
  return (
    <Card className="flex flex-col items-center gap-3 py-10 text-center" role="status">
      <Spinner size="lg" className="text-accent" label={`${client} is starting`} />
      <h2 className="text-lg font-semibold">{client} is starting</h2>
      <p className="max-w-md text-sm text-fg-muted">
        The validator list appears when {client} answers. That can take a few minutes after a restart or an update. This
        page tries again by itself.
      </p>
      {isAdvanced && <p className="max-w-md break-words text-xs text-fg-muted">Last error: {message}</p>}
    </Card>
  );
}

function EmptyState() {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <h2 className="text-xl font-semibold">No validators yet</h2>
      <p className="max-w-md text-sm text-fg-muted">
        Add the keystore files you created for your deposit. You can add many at once, and your keys never leave this
        box.
      </p>
      <div className="mt-2">
        <AddButton size="lg" />
      </div>
    </Card>
  );
}

type Dialog = { action: ValidatorAction; row: ValidatorRowData } | null;

export interface ValidatorsPageProps {
  /** Refresh interval (default 60 s). */
  pollMs?: number;
  /** Retry interval while the client doesn't answer (default 10 s). */
  retryMs?: number;
}

/** Home page: every validator key on the node, with its actions. */
export default function ValidatorsPage({ pollMs, retryMs }: ValidatorsPageProps = {}) {
  const config = useClientConfig();
  const client = clientDisplayName(config.client);
  const { data, error, refresh } = useValidators(pollMs, retryMs);
  const [dialog, setDialog] = useState<Dialog>(null);
  const followUps = useRef<ReturnType<typeof setTimeout>[]>([]);

  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => () => followUps.current.forEach(clearTimeout), []);

  // When a dialog closes, the Modal returns focus to the button that opened
  // it. After a remove that button's row is gone, so focus would fall to the
  // page body: move it to the heading instead.
  const hadDialog = useRef(false);
  useEffect(() => {
    if (dialog) {
      hadDialog.current = true;
      return;
    }
    if (!hadDialog.current) return;
    hadDialog.current = false;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) headingRef.current?.focus();
  }, [dialog]);

  const onAction = (action: ValidatorAction, row: ValidatorRowData) => setDialog({ action, row });
  const close = () => setDialog(null);
  const changed = () => void refresh();
  /** An exit takes a while to show up in the beacon state: check again a few times. */
  const exited = () => {
    void refresh();
    followUps.current.push(setTimeout(() => void refresh(), 15_000), setTimeout(() => void refresh(), 2 * 60_000));
  };

  const rows = data?.rows ?? [];
  const indices = rows.flatMap((r) => (r.state ? [r.state.index] : []));
  const defaultFeeRecipient = data?.defaultFeeRecipient ?? "";

  let body;
  if (!data && error) body = <StartingState client={client} message={error.message} />;
  else if (!data) body = <LoadingState />;
  else if (rows.length === 0) body = <EmptyState />;
  else {
    const item = { network: config.network, defaultFeeRecipient, onAction };
    body = (
      <>
        {error && (
          <p role="status" className="mb-4 rounded-lg border border-warning/30 bg-warning-subtle px-4 py-2.5 text-sm text-warning-text">
            {client} isn't answering right now, so this is the last known state. This page tries again by itself.
          </p>
        )}
        <Card padding="none" className="hidden overflow-hidden lg:block">
          <Table aria-label="Validators">
            <THead>
              <TR>
                <TH>Validator</TH>
                <TH>Status</TH>
                <TH>Balance</TH>
                <TH>Fee recipient</TH>
                <TH>Withdrawals</TH>
                <TH align="right">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <ValidatorRow key={row.pubkey} row={row} {...item} />
              ))}
            </TBody>
          </Table>
        </Card>
        <ul aria-label="Validators" className="flex flex-col gap-3 lg:hidden">
          {rows.map((row) => (
            <ValidatorCard key={row.pubkey} row={row} {...item} />
          ))}
        </ul>
        {indices.length > 0 && (
          <p className="mt-4 text-sm">
            <a
              href={beaconchainDashboardUrl(config.network, indices)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-medium"
            >
              See all on the beaconcha.in dashboard
              <ExternalIcon />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </p>
        )}
      </>
    );
  }

  return (
    <div className="min-w-0">
      <Header ref={headingRef} count={data ? rows.length : undefined} action={data && rows.length > 0 ? <AddButton /> : undefined} />
      {body}
      <FeeRecipientDialog
        row={dialog?.action === "fee" ? dialog.row : null}
        defaultFeeRecipient={defaultFeeRecipient}
        onClose={close}
        onChanged={changed}
      />
      <RemoveDialog row={dialog?.action === "remove" ? dialog.row : null} onClose={close} onRemoved={changed} />
      <ExitDialog row={dialog?.action === "exit" ? dialog.row : null} onClose={close} onSubmitted={exited} />
    </div>
  );
}
