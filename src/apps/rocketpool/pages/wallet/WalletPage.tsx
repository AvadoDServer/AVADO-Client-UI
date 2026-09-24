import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Input, Modal } from "../../../../components/ui";
import { useMode } from "../../../../settings/ModeProvider";
import { plainError } from "../../api/errors";
import type { WalletExport } from "../../api/models";
import { useRocketpoolApi } from "../../api/RocketpoolApiProvider";
import { EXPORT_CONFIRMATION, exportWallet, getNodeStatus, getWalletStatus } from "../../api/sn";
import { useRead } from "../../api/useRead";
import { TechDetails } from "../../components/common";
import { saveFile } from "../../lib/download";
import { formatDateTime } from "../../lib/time";
import { formatEth, formatRpl, formatUnits, isZeroAddress, sameAddress } from "../../lib/units";
import { useAppStatus } from "../../status/AppStatus";
import { SETUP_WITHDRAWAL_ROUTE } from "../../status/problems";
import { LegacyMnemonic } from "../home/LegacyMnemonic";
import { Address, Callout, CopyButton, Facts, LoadError, LoadingCard, NodeGate, PageHeader, SectionCard } from "../common";
import { describeBackups, exportFileContent } from "./backups";
import { CURRENT_TARGET, DownloadBackupDialog, NEVER_SEND, RESTORE_TEXT, type BackupTarget } from "./DownloadBackup";

/** Wallet: the node wallet's address and balances, a one-click backup, the automatic backups, and the old recovery-phrase file. */
export default function WalletPage() {
  const [download, setDownload] = useState<BackupTarget | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Wallet" description="Your node wallet, its backups, and where your rewards are paid." />
      <LegacyMnemonic />
      <BackUpNow onDownload={setDownload} />
      <NodeGate>
        <Wallet />
      </NodeGate>
      <Backups onDownload={setDownload} />
      {download && <DownloadBackupDialog key={download.name} target={download} onClose={() => setDownload(null)} />}
    </div>
  );
}

/** The one-click backup: a fresh file with the wallet, its password and the validator keys. Works even while Rocket Pool is stopped. */
function BackUpNow({ onDownload }: { onDownload: (t: BackupTarget) => void }) {
  const { avado } = useAppStatus();
  if (!avado?.walletFilePresent) return null;
  return (
    <SectionCard
      title="Back up your node wallet"
      description="Download one file that lets you move your Rocket Pool node to a new AVADO if this one breaks."
      actions={
        <Button onClick={() => onDownload(avado.legacyMnemonicPresent ? { ...CURRENT_TARGET, phrase: "maybe" } : CURRENT_TARGET)}>
          Download backup
        </Button>
      }
      data-testid="backup-now"
    >
      <p className="text-sm text-fg-muted">
        Keep the file offline, for example on a USB stick in a safe place. Anyone who has it can move the funds in your node wallet. {NEVER_SEND}
      </p>
    </SectionCard>
  );
}

function Wallet() {
  const { daemonReady } = useAppStatus();
  const { isAdvanced } = useMode();
  const wallet = useRead(getWalletStatus, { enabled: daemonReady });
  const node = useRead(getNodeStatus, { enabled: daemonReady });
  const [exporting, setExporting] = useState(false);

  if (wallet.error !== undefined && !wallet.data) return <LoadError what="the wallet" error={wallet.error} onRetry={() => void wallet.refresh()} />;
  if (!wallet.data) return <LoadingCard label="Loading the wallet" />;
  const address = wallet.data.accountAddress;
  const status = node.data;

  return (
    <>
      <SectionCard
        title="Node wallet"
        description="The wallet on this AVADO that runs your Rocket Pool node and pays its network fees."
        data-testid="node-wallet"
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="break-all font-mono text-fg">{address}</span>
          <CopyButton text={address} label="Copy address" />
          <Address address={address} />
        </div>
        {status && (
          <Facts
            items={[
              { label: "ETH", value: formatEth(status.accountBalances.eth) },
              { label: "RPL", value: formatRpl(status.accountBalances.rpl), hint: "Rocket Pool's own token." },
              { label: "rETH", value: `${formatUnits(status.accountBalances.reth)} rETH`, hint: "Rocket Pool's staked-ETH token." },
            ]}
          />
        )}
        {wallet.data.isMasquerading && (
          <Callout tone="warning" title="Viewing another node">
            <p>Rocket Pool is showing another node's address, for viewing only. Nothing can be sent from here.</p>
          </Callout>
        )}
      </SectionCard>

      {status && (
        <SectionCard
          title="Where your rewards and bond go"
          description="Your withdrawal address is the wallet your staked ETH and rewards are paid to. Once it is a wallet outside this AVADO, only that wallet can change it."
        >
          <Facts
            items={[
              {
                label: "Withdrawal address",
                value: <Address address={status.primaryWithdrawalAddress} full />,
                hint: sameAddress(status.primaryWithdrawalAddress, address) ? (
                  <>
                    This is still the node wallet. A wallet you control yourself (a hardware wallet is best) is safer:{" "}
                    <Link to={SETUP_WITHDRAWAL_ROUTE} className="font-semibold text-accent underline underline-offset-2">
                      set one
                    </Link>
                    .
                  </>
                )
                  : !isZeroAddress(status.pendingPrimaryWithdrawalAddress)
                    ? `Waiting to change to ${status.pendingPrimaryWithdrawalAddress}: that wallet still has to confirm it.`
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

      {isAdvanced && (
        <SectionCard
          title="Show the wallet's secrets"
          description="Shows the wallet file, its password and the node account's private key on screen, for moving the wallet by hand."
          actions={
            <Button variant="secondary" onClick={() => setExporting(true)} disabled={wallet.data.isMasquerading}>
              Show the secrets…
            </Button>
          }
        />
      )}

      {exporting && <ExportDialog nodeAddress={address} onClose={() => setExporting(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ */

type ExportPhase = { k: "confirm" } | { k: "busy" } | { k: "error"; error: unknown } | { k: "done"; data: WalletExport };

function download(name: string, content: string) {
  saveFile(new Blob([content], { type: "application/json" }), name);
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
      setPhase({ k: "error", error: err });
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
        title="Your wallet's secrets"
        size="lg"
        footer={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <div className="flex flex-col gap-4 text-sm">
          <Callout tone="warning" title="Keep this secret">
            <p>Anyone with this file or these values controls your node wallet. Store it offline (for example on a USB stick in a safe place).</p>
            <p className="font-semibold">Never send this file or these values to anyone — AVADO support will never ask for them.</p>
            <p>{RESTORE_TEXT}</p>
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
      title="Show the wallet's secrets"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="export-form" disabled={!matches} loading={busy}>
            Show the secrets
          </Button>
        </>
      }
    >
      <form id="export-form" onSubmit={submit} className="flex flex-col gap-4 text-sm">
        <Callout tone="warning" title="This shows secrets">
          <p>This shows the wallet file, its password and the private key of the node account. Anyone who sees them can take the funds in the node wallet.</p>
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
          <Callout tone="danger" title="The secrets could not be shown" role="alert">
            <p>{plainError(phase.error)}</p>
            <TechDetails error={phase.error} />
          </Callout>
        )}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

function Backups({ onDownload }: { onDownload: (t: BackupTarget) => void }) {
  const { avado } = useAppStatus();
  const { isAdvanced } = useMode();
  if (!avado) return null;
  const list = describeBackups(avado.backups);
  return (
    <SectionCard
      title="Automatic backups"
      description="The package makes these by itself on this AVADO: before updates, when the wallet is set up or changed, and when you download a backup. It keeps the most recent ones, and the first ones for good. Download one to keep a copy somewhere else."
      data-testid="backups"
    >
      {list.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No backups yet. One is made by itself before the next update, and one each time you press Download backup.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((b) => (
            <li key={b.name}>
              <Card padding="sm" className="flex flex-col gap-2 bg-bg-subtle sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold text-fg">{b.title}</p>
                    {b.time !== null && <p className="text-xs text-fg-muted">{formatDateTime(b.time)}</p>}
                  </div>
                  <p className="text-sm text-fg-muted">{b.text}</p>
                  {isAdvanced && <p className="break-all font-mono text-xs text-fg-muted">{b.name}</p>}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-shrink-0 self-start sm:self-center"
                  aria-label={`Download ${b.title}${b.time !== null ? ` from ${formatDateTime(b.time)}` : ""}`}
                  // While the old phrase file is still next to the wallet, any backup may include it.
                  onClick={() => onDownload({ name: b.name, title: b.title, phrase: b.phrase === true ? true : avado.legacyMnemonicPresent ? "maybe" : b.phrase })}
                >
                  Download
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
