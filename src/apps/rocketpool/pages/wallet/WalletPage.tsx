import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Input, Modal } from "../../../../components/ui";
import { plainError } from "../../api/errors";
import { ARCHIVE_CONFIRMATION, type WalletExport } from "../../api/models";
import { useRocketpoolApi } from "../../api/RocketpoolApiProvider";
import { EXPORT_CONFIRMATION, exportWallet, getNodeStatus, getWalletStatus } from "../../api/sn";
import { useRead } from "../../api/useRead";
import { formatDateTime } from "../../lib/time";
import { formatEth, formatRpl, formatUnits, isZeroAddress, sameAddress } from "../../lib/units";
import { useAppStatus } from "../../status/AppStatus";
import { SUPPORT_EMAIL } from "../../status/problems";
import { Address, Callout, CopyButton, Facts, LoadError, LoadingCard, NodeGate, PageHeader, SectionCard } from "../common";
import { ADMIN_PACKAGE_URL, BACKUP_DIR, describeBackups, exportFileContent } from "./backups";

/** Wallet: the node wallet's address and balances, a backup export, the backups on the box, and the old recovery-phrase file. */
export default function WalletPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Wallet" description="Your node wallet, its backup, and where your rewards are paid." />
      <OldPhraseFile />
      <NodeGate>
        <Wallet />
      </NodeGate>
      <Backups />
    </div>
  );
}

function Wallet() {
  const { daemonReady } = useAppStatus();
  const wallet = useRead(getWalletStatus, { enabled: daemonReady });
  const node = useRead(getNodeStatus, { enabled: daemonReady });
  const [exporting, setExporting] = useState(false);

  if (wallet.error !== undefined && !wallet.data) return <LoadError what="the wallet" error={wallet.error} onRetry={() => void wallet.refresh()} />;
  if (!wallet.data) return <LoadingCard label="Loading the wallet" />;
  const address = wallet.data.accountAddress;
  const status = node.data;

  return (
    <>
      <SectionCard title="Node wallet" description="The wallet on this AVADO that runs your Rocket Pool node and pays the network fees." data-testid="node-wallet">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="break-all font-mono text-fg">{address}</span>
          <CopyButton text={address} label="Copy address" />
          <Address address={address} />
        </div>
        {status && (
          <Facts
            items={[
              { label: "ETH", value: formatEth(status.accountBalances.eth) },
              { label: "RPL", value: formatRpl(status.accountBalances.rpl) },
              { label: "rETH", value: `${formatUnits(status.accountBalances.reth)} rETH` },
            ]}
          />
        )}
        {wallet.data.isMasquerading && (
          <Callout tone="warning" title="Viewing another node">
            <p>Rocket Pool is showing another node's address (read-only). Nothing can be sent from here.</p>
          </Callout>
        )}
      </SectionCard>

      {status && (
        <SectionCard title="Where your rewards and bond go" description="Set when the node was set up. They can only be changed from these addresses themselves, not from the node.">
          <Facts
            items={[
              {
                label: "Withdrawal address",
                value: <Address address={status.primaryWithdrawalAddress} full />,
                hint: sameAddress(status.primaryWithdrawalAddress, address)
                  ? "This is still the node wallet. A withdrawal address you control (a hardware wallet) is safer."
                  : !isZeroAddress(status.pendingPrimaryWithdrawalAddress)
                    ? `Waiting to change to ${status.pendingPrimaryWithdrawalAddress}: that address must confirm it.`
                    : undefined,
              },
              {
                label: "RPL withdrawal address",
                value: status.isRPLWithdrawalAddressSet ? <Address address={status.rplWithdrawalAddress} full /> : "Same as the withdrawal address",
              },
            ]}
          />
        </SectionCard>
      )}

      <SectionCard
        title="Back up the wallet"
        description="Download the wallet file, its password and the node account key. Keep it offline: anyone with it controls the node wallet."
        actions={
          <Button variant="secondary" onClick={() => setExporting(true)} disabled={wallet.data.isMasquerading}>
            Back up the wallet…
          </Button>
        }
      >
        <p className="text-sm text-fg-muted">
          The validator keys can be recreated from the wallet. The package also keeps automatic backups on this AVADO (listed below).
        </p>
      </SectionCard>

      {exporting && <ExportDialog nodeAddress={address} onClose={() => setExporting(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ */

type ExportPhase = { k: "confirm" } | { k: "busy" } | { k: "error"; message: string } | { k: "done"; data: WalletExport };

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The export: typed confirmation (EXPORT) → one POST → the secret shown
 * only on request and downloadable as a file. It lives in this dialog's
 * state only and is gone when the dialog closes.
 */
function ExportDialog({ nodeAddress, onClose }: { nodeAddress: string; onClose: () => void }) {
  const api = useRocketpoolApi();
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<ExportPhase>({ k: "confirm" });
  const [reveal, setReveal] = useState(false);
  const inFlight = useRef(false);
  const matches = typed.trim() === EXPORT_CONFIRMATION;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!matches || inFlight.current) return;
    inFlight.current = true;
    setPhase({ k: "busy" });
    try {
      const data = await exportWallet(api, typed.trim());
      setPhase({ k: "done", data });
    } catch (err) {
      setPhase({ k: "error", message: plainError(err) });
    } finally {
      inFlight.current = false;
    }
  };

  if (phase.k === "done") {
    const { data } = phase;
    return (
      <Modal
        open
        onClose={onClose}
        title="Your wallet backup"
        size="lg"
        footer={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <div className="flex flex-col gap-4 text-sm">
          <Callout tone="warning" title="Keep this secret">
            <p>Anyone with this file or these values controls your node wallet. Store it offline (for example on a USB stick in a safe place). Never share it, not even with support.</p>
          </Callout>
          <div>
            <Button onClick={() => download(`rocketpool-wallet-${nodeAddress.toLowerCase()}.json`, exportFileContent(data, nodeAddress))}>Download the backup file</Button>
          </div>
          <div className="flex flex-col gap-2">
            <Button variant="ghost" size="sm" className="self-start" aria-expanded={reveal} onClick={() => setReveal((r) => !r)}>
              {reveal ? "Hide the values" : "Show the values on screen"}
            </Button>
            {reveal && (
              <dl className="flex flex-col gap-3" data-testid="export-values">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">Wallet password</dt>
                  <dd className="mt-1 flex flex-wrap items-center gap-2 break-all font-mono text-fg">
                    {data.password} <CopyButton text={data.password} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">Node account private key</dt>
                  <dd className="mt-1 flex flex-wrap items-center gap-2 break-all font-mono text-fg">
                    {data.accountPrivateKey} <CopyButton text={data.accountPrivateKey} />
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </div>
      </Modal>
    );
  }

  const busy = phase.k === "busy";
  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      closeOnBackdrop={!busy}
      title="Back up the node wallet"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="export-form" disabled={!matches} loading={busy}>
            Show the backup
          </Button>
        </>
      }
    >
      <form id="export-form" onSubmit={submit} className="flex flex-col gap-4 text-sm">
        <Callout tone="warning" title="This shows secrets">
          <p>The backup contains the wallet file, its password and the private key of the node account. Anyone who sees them can take the funds in the node wallet.</p>
          <p>Make sure nobody is watching your screen.</p>
        </Callout>
        <Input
          label={
            <>
              Type <span className="font-mono font-semibold text-fg">{EXPORT_CONFIRMATION}</span> to confirm
            </>
          }
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {phase.k === "error" && (
          <Callout tone="danger" title="The backup could not be made" role="alert">
            <p>{phase.message}</p>
          </Callout>
        )}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

function Backups() {
  const { avado } = useAppStatus();
  if (!avado) return null;
  const list = describeBackups(avado.backups);
  return (
    <SectionCard
      title="Backups on this AVADO"
      description={
        <>
          Made automatically by the package, in <span className="font-mono">{BACKUP_DIR}</span> inside the Rocket Pool package. They are
          never deleted by a wallet change.
        </>
      }
      data-testid="backups"
    >
      {list.length === 0 ? (
        <p className="text-sm text-fg-muted">No backups yet. One is made automatically before every update.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((b) => (
            <li key={b.name}>
              <Card padding="sm" className="flex flex-col gap-1 bg-bg-subtle">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-fg">{b.title}</p>
                  {b.time !== null && <p className="text-xs text-fg-muted">{formatDateTime(b.time)}</p>}
                </div>
                <p className="text-sm text-fg-muted">{b.text}</p>
                <p className="break-all font-mono text-xs text-fg">{b.path}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-fg-muted">
        To download one, open the{" "}
        <a href={ADMIN_PACKAGE_URL} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">
          Rocket Pool package in the AVADO Admin<span className="sr-only"> (opens in a new tab)</span>
        </a>
        , go to File manager → Download from DApp, and enter its path.
      </p>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */

/** The old package kept the recovery phrase in a plain file: explain it and offer to move it into the backups. */
function OldPhraseFile() {
  const { avado, refresh } = useAppStatus();
  const [open, setOpen] = useState(false);
  const [moved, setMoved] = useState<string | null>(null);
  if (moved) {
    return (
      <Callout tone="success" title="The recovery phrase file was moved" role="status">
        <p>
          It is now in <span className="font-mono">{`${BACKUP_DIR}/${moved}`}</span>, out of the data folder. Keep your written copy
          of the recovery phrase somewhere safe.
        </p>
      </Callout>
    );
  }
  if (!avado?.legacyMnemonicPresent) return null;
  return (
    <>
      <Callout tone="warning" title="The old recovery phrase file is still on this AVADO">
        <p>
          The old Rocket Pool package saved your wallet's recovery phrase (24 words) unencrypted on this AVADO. Anyone with access to
          the box could read it.
        </p>
        <p>
          First make sure you have the recovery phrase written down safely. The old package never showed it to you: if you have no copy,
          see the steps on the{" "}
          <Link to="/" className="font-semibold text-accent underline underline-offset-2">
            Home page
          </Link>{" "}
          or contact {SUPPORT_EMAIL} first. Then move the file out of the data folder into the backups
          folder.
        </p>
        <div>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            Move the file…
          </Button>
        </div>
      </Callout>
      {open && (
        <ArchiveDialog
          onClose={() => setOpen(false)}
          onMoved={(name) => {
            setOpen(false);
            setMoved(name);
            void refresh();
          }}
        />
      )}
    </>
  );
}

function ArchiveDialog({ onClose, onMoved }: { onClose: () => void; onMoved: (name: string) => void }) {
  const api = useRocketpoolApi();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const matches = typed.trim() === ARCHIVE_CONFIRMATION;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!matches || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await api.archiveLegacyMnemonic(typed.trim());
      onMoved(r.name);
    } catch (err) {
      setError(plainError(err));
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      closeOnBackdrop={!busy}
      title="Move the recovery phrase file"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="archive-form" disabled={!matches} loading={busy}>
            Move the file
          </Button>
        </>
      }
    >
      <form id="archive-form" onSubmit={submit} className="flex flex-col gap-4 text-sm">
        <p>
          The file is moved into <span className="font-mono">{BACKUP_DIR}</span> on this AVADO: it is not deleted, and the wallet keeps
          working as before. It is still on the box, so keep the AVADO itself safe.
        </p>
        <Input
          label={
            <>
              Type <span className="font-mono font-semibold text-fg">{ARCHIVE_CONFIRMATION}</span> to confirm
            </>
          }
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {error && (
          <Callout tone="danger" title="The file could not be moved" role="alert">
            <p>{error}</p>
          </Callout>
        )}
      </form>
    </Modal>
  );
}
