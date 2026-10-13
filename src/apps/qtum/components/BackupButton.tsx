import { useState } from "react";
import { Button, type ButtonVariant } from "../../../components/ui";
import { addressesMakingOne } from "../api/node";
import { useQtumApi } from "../api/QtumApiProvider";
import { saveFile } from "../lib/download";
import { useAppStatus } from "../status/AppStatus";
import { Notice, TechDetails } from "./common";

export const BACKUP_FAILED = "The backup could not be downloaded. If the Qtum node is still starting, please try again in a few minutes.";
export const BACKUP_SAVED = "Your wallet backup was downloaded. Keep the file somewhere safe, for example on a USB stick: anyone who has it can take your coins.";

/**
 * Downloads a fresh wallet backup and records it (the "backup required"
 * messages go away), as the old wizard did. A wallet that still needs its
 * first backup gets an address first, when it has none.
 */
export function BackupButton({ label = "Download wallet backup", variant = "primary" }: { label?: string; variant?: ButtonVariant }) {
  const api = useQtumApi();
  const { backupRequired, walletStatus, refreshWallet, refreshSettings } = useAppStatus();
  // not while the wallet is being upgraded, rebuilt or restored (the monitor refuses it too)
  const busy = !!walletStatus?.busy;
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; error?: unknown } | null>(null);

  const download = async () => {
    setWorking(true);
    setOutcome(null);
    try {
      if (backupRequired) {
        try {
          await addressesMakingOne(api);
        } catch {
          /* the backup is still worth having */
        }
      }
      const { blob, fileName } = await api.downloadBackup();
      saveFile(blob, fileName);
      try {
        await api.backupDone();
      } catch {
        /* the backup was saved; the reminder may show once more */
      }
      setOutcome({ ok: true });
      await Promise.all([refreshWallet(), refreshSettings()]);
    } catch (error) {
      setOutcome({ ok: false, error });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-3">
      <Button variant={variant} loading={working} disabled={busy} onClick={download}>
        {label}
      </Button>
      {busy && (
        <p className="text-sm text-fg-muted" data-testid="backup-busy">
          A backup can be downloaded once the wallet task at the top of the page is done.
        </p>
      )}
      {outcome?.ok && (
        <Notice tone="success" live testId="backup-saved">
          <p>{BACKUP_SAVED}</p>
        </Notice>
      )}
      {outcome && !outcome.ok && (
        <Notice tone="danger" live testId="backup-failed">
          <p>{BACKUP_FAILED}</p>
          <TechDetails error={outcome.error} />
        </Notice>
      )}
    </div>
  );
}
