import { useRef, useState } from "react";
import { Button, Card, CardDescription, CardTitle, Input } from "../../../../components/ui";
import { isRpApiError, plainError } from "../../api/errors";
import { ARCHIVE_CONFIRMATION } from "../../api/models";
import { useRocketpoolApi } from "../../api/RocketpoolApiProvider";
import { Notice, TechDetails } from "../../components/common";
import { SUPPORT_EMAIL } from "../../status/problems";
import { useAppStatus } from "../../status/AppStatus";
import { DownloadBackupDialog } from "../wallet/DownloadBackup";

/**
 * The old package (before 1.0) saved the recovery phrase as plain text next
 * to the wallet. This explains it, moves the file into the package's backups
 * (the backend moves, never deletes; typed ARCHIVE), and then offers it as a
 * one-click download so an owner without a written copy can make one.
 */
export function LegacyMnemonic() {
  const api = useRocketpoolApi();
  const { avado, refresh } = useAppStatus();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const sending = useRef(false);

  if (!avado?.legacyMnemonicPresent && !movedTo) return null;
  const confirmOk = typed.trim() === ARCHIVE_CONFIRMATION;

  const archive = async () => {
    if (!confirmOk || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await api.archiveLegacyMnemonic(typed.trim());
      setMovedTo(res.name);
      setTyped("");
      await refresh();
    } catch (e) {
      if (isRpApiError(e) && e.status === 404) {
        setMovedTo("");
        await refresh();
      } else {
        setError(e);
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  if (movedTo !== null) {
    return (
      <Card as="section" aria-labelledby="legacy-phrase-title" className="flex flex-col gap-3" data-testid="legacy-mnemonic">
        <CardTitle id="legacy-phrase-title">Recovery phrase file</CardTitle>
        <Notice tone="success" title={movedTo ? "The file was moved into the backups" : "The file was already moved"} live>
          <p>
            It no longer sits next to your wallet. Nothing was deleted, and your node keeps working as before. The file is still on this
            AVADO, so keep the AVADO itself somewhere safe.
          </p>
          <p>
            Your written copy of the 24 words is the only way to restore the node wallet elsewhere. If you don't have one yet, download the
            file, write the words on paper, then delete the file or keep it offline.
          </p>
          {movedTo && (
            <div>
              <Button variant="secondary" size="sm" onClick={() => setDownloading(true)}>
                Download the recovery phrase file
              </Button>
            </div>
          )}
        </Notice>
        {downloading && movedTo && (
          <DownloadBackupDialog target={{ name: movedTo, title: "Old recovery phrase file", phrase: true }} onClose={() => setDownloading(false)} />
        )}
      </Card>
    );
  }

  return (
    <Card as="section" aria-labelledby="legacy-phrase-title" className="flex flex-col gap-4" data-testid="legacy-mnemonic">
      <div>
        <CardTitle id="legacy-phrase-title">Your recovery phrase is saved in an unprotected file</CardTitle>
        <CardDescription>
          The old version of this package saved your node wallet's recovery phrase (24 words) as plain text on this AVADO. Anyone who
          gets that file controls your node wallet.
        </CardDescription>
      </div>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-fg">
        <li>
          <span className="font-semibold">Check that you have the 24 words written on paper.</span> The old version never showed them to
          you. If you once downloaded its backup (<span className="font-mono">rocket-pool-backup.zip</span>), the words are in the file
          called <span className="font-mono">mnemonic</span> inside it. If you have no copy at all: after step 2 you can download the file
          with one click and write the words down from it. Questions? Email{" "}
          <a className="font-semibold text-accent underline underline-offset-2" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </li>
        <li>
          <span className="font-semibold">Move the file into the backups.</span> It then no longer sits next to your wallet. Nothing is
          deleted and your node keeps working. The file is still on this AVADO afterwards, so this is tidying up, not full protection.
        </li>
      </ol>
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
        className="max-w-xs"
      />
      <div>
        <Button variant="primary" onClick={archive} disabled={!confirmOk} loading={busy}>
          Move the file into the backups
        </Button>
      </div>
      {error !== null && (
        <Notice tone="danger" title="The file was not moved" live>
          <p>{plainError(error)}</p>
          <TechDetails error={error} />
        </Notice>
      )}
    </Card>
  );
}

export default LegacyMnemonic;
