import { useEffect, useRef, useState } from "react";
import { Button, Modal, Spinner } from "../../../../components/ui";
import { plainError } from "../../api/errors";
import { CURRENT_BACKUP } from "../../api/models";
import { useRocketpoolApi } from "../../api/RocketpoolApiProvider";
import { Notice, TechDetails } from "../../components/common";
import { saveFile } from "../../lib/download";
import { useAppStatus } from "../../status/AppStatus";

/** What to download: a fresh backup ("current") or one of the listed backups. */
export interface BackupTarget {
  /** "current", or a backup's name from the status. */
  name: string;
  /** How the owner knows it, e.g. "Automatic backup (from version 0.0.107)". */
  title: string;
  /** The file holds the old package's plain-text recovery phrase. */
  phrase?: boolean;
}

export const CURRENT_TARGET: BackupTarget = { name: CURRENT_BACKUP, title: "Backup of your node wallet" };

/** The exact warning in the download dialog (owner's wording). */
export const BACKUP_WARNING =
  "This file can control your Rocket Pool node's hot wallet (the node wallet on this AVADO). Keep it somewhere safe and offline; anyone with it can move your funds.";
export const PHRASE_WARNING =
  "This file holds your node wallet's recovery phrase (24 words) as plain text. Anyone who reads it can move your funds. Write the words on paper, then keep the file somewhere safe and offline, or delete it.";

type Phase = { k: "confirm" } | { k: "busy" } | { k: "done"; fileName: string } | { k: "error"; error: unknown };

/**
 * One click to a backup file: a plain warning, one Download button, then
 * fetch → blob → a download link made on the page. The file is never kept by
 * the page: it goes straight to the browser's downloads.
 */
export function DownloadBackupDialog({ target, onClose }: { target: BackupTarget; onClose: () => void }) {
  const api = useRocketpoolApi();
  const { refresh } = useAppStatus();
  const [phase, setPhase] = useState<Phase>({ k: "confirm" });
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const download = async () => {
    if (inFlight.current) return;
    const abort = new AbortController();
    inFlight.current = abort;
    setPhase({ k: "busy" });
    try {
      const file = await api.downloadBackup(target.name, { signal: abort.signal });
      if (abort.signal.aborted) return;
      saveFile(file.blob, file.fileName);
      setPhase({ k: "done", fileName: file.fileName });
      // A fresh backup stays on the box too: show it in the list.
      if (target.name === CURRENT_BACKUP) void refresh();
    } catch (error) {
      if (!abort.signal.aborted) setPhase({ k: "error", error });
    } finally {
      if (inFlight.current === abort) inFlight.current = null;
    }
  };

  const cancel = () => {
    inFlight.current?.abort();
    inFlight.current = null;
    onClose();
  };

  const busy = phase.k === "busy";
  let footer;
  if (phase.k === "done") {
    footer = (
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    );
  } else {
    footer = (
      <>
        <Button variant="secondary" onClick={cancel}>
          Cancel
        </Button>
        <Button onClick={download} loading={busy} disabled={busy}>
          {phase.k === "error" ? "Try again" : "Download"}
        </Button>
      </>
    );
  }

  return (
    <Modal open onClose={cancel} closeOnBackdrop={!busy} title={phase.k === "done" ? "Backup downloaded" : "Download backup"} size="md" footer={footer}>
      <div className="flex flex-col gap-4 text-sm text-fg" data-testid="download-backup">
        {phase.k === "done" ? (
          <Notice tone="success" title="The file is in your downloads" live>
            <p>
              Look for <span className="font-semibold [overflow-wrap:anywhere]">{phase.fileName}</span> in your browser's downloads.
            </p>
            <p>Move it somewhere safe and offline, for example a USB stick you keep in a drawer. Don't email it or put it in a cloud folder.</p>
          </Notice>
        ) : (
          <>
            <p className="font-semibold">{target.title}</p>
            <Notice tone="warning" title="Keep this file secret">
              <p>{target.phrase ? PHRASE_WARNING : BACKUP_WARNING}</p>
            </Notice>
            {!target.phrase && (
              <p className="text-fg-muted">
                With this file, AVADO support can bring your node wallet back if this AVADO breaks. It is a .zip file with the wallet, its
                password and your validator keys.
              </p>
            )}
            {busy && (
              <p className="flex items-center gap-2 text-fg-muted" role="status">
                <Spinner size="sm" label="Preparing" /> Preparing the file. This can take up to a minute…
              </p>
            )}
            {phase.k === "error" && (
              <Notice tone="danger" title="The backup could not be downloaded" live>
                <p>{plainError(phase.error)}</p>
                <TechDetails error={phase.error} />
              </Notice>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

export default DownloadBackupDialog;
