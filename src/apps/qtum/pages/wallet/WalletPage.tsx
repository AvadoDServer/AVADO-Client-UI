import { useRef, useState, type FormEvent } from "react";
import { Button, ConfirmDialog, Input, StatusPill } from "../../../../components/ui";
import { isQtumApiError, plainError } from "../../api/errors";
import { addressesMakingOne, lockWallet, newAddress, readWallet, unlockForStaking } from "../../api/node";
import { useQtumApi } from "../../api/QtumApiProvider";
import { useRead } from "../../api/useRead";
import { BackupButton } from "../../components/BackupButton";
import { CopyButton, ExternalLink, LoadingLines, Notice, PageHeader, SectionCard, TechDetails } from "../../components/common";
import { WEB_WALLET_URL } from "../../lib/links";
import { useAppStatus } from "../../status/AppStatus";

/** Addresses change only when the owner makes one: read them now and then. */
export const ADDRESSES_READ_MS = 60_000;

type Outcome = { tone: "success" | "danger"; text: string; error?: unknown } | null;

function OutcomeNote({ outcome, testId }: { outcome: Outcome; testId: string }) {
  if (!outcome) return null;
  return (
    <Notice tone={outcome.tone} live testId={testId}>
      <p>{outcome.text}</p>
      {outcome.error !== undefined && <TechDetails error={outcome.error} />}
    </Notice>
  );
}

/** Shown instead of the addresses until the first backup is downloaded (as the old page did: back up first). */
export const BACKUP_FIRST = "Download your backup first; your addresses show here after that.";

function Addresses({ enabled, backupFirst }: { enabled: boolean; backupFirst: boolean }) {
  const api = useQtumApi();
  const list = useRead(addressesMakingOne, { enabled: enabled && !backupFirst, intervalMs: ADDRESSES_READ_MS });
  const [label, setLabel] = useState("");
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setWorking(true);
    setOutcome(null);
    try {
      const address = await newAddress(api, label);
      setLabel("");
      setOutcome({ tone: "success", text: `New address made: ${address}` });
      await list.refresh();
    } catch (error) {
      setOutcome({ tone: "danger", text: `The address could not be made. ${plainError(error)}`, error });
    } finally {
      setWorking(false);
    }
  };

  return (
    <SectionCard
      title="Addresses"
      description="Send QTUM to any of these addresses. They all belong to the wallet on your AVADO, and coins on all of them stake."
      testId="addresses"
    >
      {backupFirst ? (
        <p className="text-sm text-fg" data-testid="backup-first">
          {BACKUP_FIRST}
        </p>
      ) : !enabled ? (
        <p className="text-sm text-fg-muted">Shows here once your wallet is ready.</p>
      ) : list.data ? (
        <ul className="flex flex-col divide-y divide-border" aria-label="Wallet addresses">
          {list.data.map((a) => (
            <li key={a.address} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">{a.label || "No label"}</p>
                <p className="break-all font-mono text-[0.8125rem] text-fg">{a.address}</p>
              </div>
              <CopyButton text={a.address} srLabel={`Copy address ${a.address}`} />
            </li>
          ))}
        </ul>
      ) : list.error !== undefined ? (
        <Notice tone="danger" title="Could not load your addresses">
          <p>{plainError(list.error)}</p>
          <TechDetails error={list.error} />
        </Notice>
      ) : (
        <LoadingLines />
      )}
      {enabled && !backupFirst && (
        <form onSubmit={create} className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-end">
          <Input
            label="Name for a new address (optional)"
            value={label}
            maxLength={100}
            onChange={(e) => setLabel(e.target.value)}
            className="sm:max-w-sm sm:flex-1"
          />
          <Button type="submit" variant="secondary" loading={working}>
            Make a new address
          </Button>
        </form>
      )}
      <OutcomeNote outcome={outcome} testId="address-outcome" />
    </SectionCard>
  );
}

/** Unlock a wallet with a password for staking (never stored), or lock it again. */
function StakingPassword({ enabled }: { enabled: boolean }) {
  const api = useQtumApi();
  const wallet = useRead(readWallet, { enabled });
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const w = wallet.data;
  if (!w || !w.encrypted) return null;

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setWorking(true);
    setOutcome(null);
    try {
      await unlockForStaking(api, password);
      setOutcome({
        tone: "success",
        text: "Your wallet is unlocked for staking. It can stake, but it cannot send coins. When the Qtum node restarts, the wallet is locked again: unlock it here once more.",
      });
    } catch (error) {
      setOutcome({ tone: "danger", text: plainError(error), error });
    } finally {
      // The password is never kept, also not after a failure.
      setPassword("");
      setWorking(false);
      await wallet.refresh();
    }
  };

  const lock = async () => {
    setWorking(true);
    setOutcome(null);
    try {
      await lockWallet(api);
      setOutcome({ tone: "success", text: "Your wallet is locked. It does not stake until you unlock it again." });
    } catch (error) {
      setOutcome({ tone: "danger", text: plainError(error), error });
    } finally {
      setWorking(false);
      await wallet.refresh();
    }
  };

  return (
    <SectionCard
      title="Staking password"
      description="Your wallet has a password. A locked wallet does not stake. Unlocking it here lets it stake, but not send coins. Your password is not stored anywhere."
      testId="staking-password"
    >
      <div data-testid="lock-state">
        <StatusPill status={w.unlocked ? { tone: "success", label: "Unlocked for staking" } : { tone: "warning", label: "Locked" }} />
      </div>
      {w.unlocked ? (
        <div>
          <Button variant="secondary" onClick={lock} loading={working}>
            Lock the wallet
          </Button>
        </div>
      ) : (
        <form onSubmit={unlock} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input
            type="password"
            label="Wallet password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="sm:max-w-sm sm:flex-1"
          />
          <Button type="submit" disabled={!password} loading={working}>
            Unlock for staking
          </Button>
        </form>
      )}
      <OutcomeNote outcome={outcome} testId="unlock-outcome" />
    </SectionCard>
  );
}

const restoreError = (err: unknown) =>
  isQtumApiError(err) && err.kind === "http" && err.detail ? err.detail : "The wallet could not be restored. Please try again.";

/** Restore a wallet backup file (the current wallet is kept on the AVADO first). */
function RestoreBackup() {
  const api = useQtumApi();
  const { refreshWallet, walletStatus } = useAppStatus();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<{ tone: "accent" | "danger"; text: string; error?: unknown } | null>(null);
  const busy = !!walletStatus?.busy;

  const clear = () => {
    setFile(null);
    if (input.current) input.current.value = "";
  };

  const restore = async () => {
    if (!file) return;
    setWorking(true);
    setResult({ tone: "accent", text: "Uploading your backup..." });
    try {
      const name = await api.uploadBackup(file);
      await api.restoreBackup(name);
      setResult({ tone: "accent", text: "Your backup is being restored. This takes a few minutes; the status is shown at the top of this page." });
      void refreshWallet();
    } catch (error) {
      setResult({ tone: "danger", text: restoreError(error), error });
    } finally {
      setWorking(false);
      clear();
    }
  };

  return (
    <SectionCard
      title="Restore from a backup"
      description="Choose a wallet backup file to restore your wallet, for example from a previous installation. Older backups are upgraded to the new wallet format automatically."
      testId="restore"
    >
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={input}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-label="Backup file"
          data-testid="restore-file"
          disabled={working || busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button variant="secondary" disabled={working || busy} onClick={() => input.current?.click()}>
          Choose a backup file
        </Button>
      </div>
      {result && (
        <Notice tone={result.tone} live testId="restore-outcome">
          <p>{result.text}</p>
          {result.error !== undefined && <TechDetails error={result.error} />}
        </Notice>
      )}
      <ConfirmDialog
        open={!!file && !working}
        title="Restore this wallet backup?"
        confirmLabel="Restore"
        onConfirm={() => void restore()}
        onCancel={clear}
      >
        The wallet on your AVADO will be replaced by the backup. Your current wallet is saved on your AVADO first, so nothing is lost.
      </ConfirmDialog>
    </SectionCard>
  );
}

/** Wallet (spec): addresses, staking password, backup and restore. */
export default function WalletPage() {
  const { walletReady, node, nodeError, backupRequired } = useAppStatus();
  const canRead = walletReady && !!node && nodeError === undefined;
  const backup = (
    <SectionCard
      title="Backup"
      description="Download a backup of your wallet. This is very important when you stake Qtum, because the wallet holds the private keys. Keep the file somewhere safe: anyone who has it can take your coins."
      testId="backup"
    >
      {backupRequired && (
        <Notice tone="warning" testId="backup-required">
          <p>You have not downloaded a backup of this wallet yet. Please do it now.</p>
        </Notice>
      )}
      <BackupButton />
    </SectionCard>
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Wallet" description="The wallet on your AVADO that holds and stakes your QTUM." />
      {/* Back up first: until then the backup comes first and the addresses wait. */}
      {backupRequired && backup}
      <Addresses enabled={canRead} backupFirst={backupRequired} />
      <SectionCard title="Send coins" description="To send coins, open the Qtum Web Wallet. It opens in a new tab." testId="send-coins">
        <div>
          <ExternalLink href={WEB_WALLET_URL}>Qtum Web Wallet (advanced)</ExternalLink>
        </div>
      </SectionCard>
      <StakingPassword enabled={canRead} />
      {!backupRequired && backup}
      <RestoreBackup />
    </div>
  );
}
