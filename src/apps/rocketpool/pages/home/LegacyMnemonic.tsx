import { useRef, useState } from "react";
import { Button, Card, CardDescription, CardTitle, Input } from "../../../../components/ui";
import { isRpApiError, plainError } from "../../api/errors";
import { ARCHIVE_CONFIRMATION } from "../../api/models";
import { useRocketpoolApi } from "../../api/RocketpoolApiProvider";
import { Notice } from "../../components/common";
import { SUPPORT_EMAIL } from "../../status/problems";
import { useAppStatus } from "../../status/AppStatus";

/**
 * The old package (before 1.0) saved the recovery phrase as plain text in the
 * data folder. This explains it and moves the file into the backups folder
 * (the backend moves, never deletes; typed ARCHIVE).
 */
export function LegacyMnemonic() {
  const api = useRocketpoolApi();
  const { avado, refresh } = useAppStatus();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movedTo, setMovedTo] = useState<string | null>(null);
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
        setError(plainError(e));
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
        <Notice tone="success" title="The file is no longer in the Rocket Pool data folder" live>
          {movedTo ? (
            <p>
              It was moved into the backups folder, <span className="break-all font-mono text-[0.8125rem]">backups/{movedTo}</span>, on
              this AVADO. Nothing was deleted.
            </p>
          ) : (
            <p>It had already been moved or removed.</p>
          )}
          <p>
            It is still plain text in the backups folder on this AVADO, as is the copy in the backup made at the first update to version 1.0.
            Keep your own written copy of the recovery phrase somewhere safe: it is the only way to restore the node wallet elsewhere.
          </p>
        </Notice>
      </Card>
    );
  }

  return (
    <Card as="section" aria-labelledby="legacy-phrase-title" className="flex flex-col gap-4" data-testid="legacy-mnemonic">
      <div>
        <CardTitle id="legacy-phrase-title">Your recovery phrase is stored in a plain file</CardTitle>
        <CardDescription>
          The previous version of this package saved your node wallet's recovery phrase as plain text in the Rocket Pool data folder.
          Whoever gets hold of it controls the node wallet.
        </CardDescription>
      </div>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-fg">
        <li>
          <span className="font-semibold">Make sure you have your own copy</span> of the recovery phrase, written on paper and kept safe.
          The previous version never showed it to you. If you ever downloaded its backup file (<span className="font-mono">rocket-pool-backup.zip</span>),
          the phrase is in the file named <span className="font-mono">mnemonic</span> inside it: write it down from there, then keep that zip
          file as safe as the phrase itself, or delete it. If you have neither, contact{" "}
          <a className="font-semibold text-accent underline underline-offset-2" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>{" "}
          first.
        </li>
        <li>
          <span className="font-semibold">Move the file into the backups folder.</span> It then no longer sits next to the wallet, and
          nothing is deleted, so it can't be lost. This is tidying up, not full protection: the moved copy is still plain text in the
          backups folder on this AVADO, and so is the copy in the backup made when this package was first updated to version 1.0.
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
          Move it into the backups folder
        </Button>
      </div>
      {error && (
        <Notice tone="danger" title="Not moved" live>
          <p>{error}</p>
        </Notice>
      )}
    </Card>
  );
}

export default LegacyMnemonic;
