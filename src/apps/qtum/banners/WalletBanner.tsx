/**
 * What the package is doing with the wallet (the upgrade to the Qtum v30
 * wallet format, a rebuild from the old copy when the upgrade fails, a
 * restore) and the request for a fresh backup after an upgrade. Shown at the
 * top of every page. The wording is the old wizard's (it was reviewed).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Input } from "../../../components/ui";
import { isQtumApiError } from "../api/errors";
import type { WalletStatus } from "../api/models";
import { useQtumApi } from "../api/QtumApiProvider";
import { BackupButton } from "../components/BackupButton";
import { Notice, type NoticeTone } from "../components/common";
import { useAppStatus } from "../status/AppStatus";

/**
 * A wallet with a password is locked after every restart, and a locked
 * wallet does not stake; the Wallet page unlocks it for staking.
 */
export const LOCKED_NOTE =
  "A wallet with a password is locked after every restart and does not stake until you unlock it for staking on the Wallet page.";

/** The monitor's plain message, or a fallback (as the old wizard's errorMessage). */
function monitorMessage(err: unknown, fallback: string): string {
  return isQtumApiError(err) && err.kind === "http" && err.detail ? err.detail : fallback;
}

function Box({ tone, testId, children }: { tone: NoticeTone; testId: string; children: ReactNode }) {
  return (
    <Notice tone={tone} testId={testId}>
      {children}
    </Notice>
  );
}

/** "Title." in bold, then the rest, as one paragraph (the old wizard's <b>…</b> …). */
function Lead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <p>
      <strong>{title}</strong> {children}
    </p>
  );
}

function DetailsToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={open}>
      {open ? "Hide details" : "Details"}
    </Button>
  );
}

export function WalletBanner() {
  const { walletStatus: status, refreshWallet } = useAppStatus();
  const api = useQtumApi();
  const [passphrase, setPassphrase] = useState("");
  const [actionMessage, setActionMessage] = useState<string | undefined>();
  const [showDetails, setShowDetails] = useState(false);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [restoreDismissed, setRestoreDismissed] = useState(false);
  const [working, setWorking] = useState(false);
  const lastRestoreAt = useRef<string | undefined>(undefined);

  // Show a new restore failure again, even after an earlier one was dismissed.
  const restoreAt = status?.restore?.at;
  useEffect(() => {
    if (restoreAt !== lastRestoreAt.current) {
      lastRestoreAt.current = restoreAt;
      setRestoreDismissed(false);
    }
  }, [restoreAt]);

  if (!status) return null;

  const retryUpgrade = async (withPassphrase: boolean) => {
    setActionMessage(undefined);
    setWorking(true);
    try {
      await api.retryUpgrade(withPassphrase ? passphrase : undefined);
      setPassphrase("");
      setActionMessage("Upgrading your wallet...");
      void refreshWallet();
    } catch (err) {
      setActionMessage(monitorMessage(err, "The upgrade could not be started. Please try again."));
    } finally {
      setWorking(false);
    }
  };

  const rebuild = async (withPassphrase: boolean) => {
    setActionMessage(undefined);
    setConfirmRebuild(false);
    setWorking(true);
    try {
      await api.rebuildWallet(withPassphrase ? passphrase : undefined);
      setPassphrase("");
      setActionMessage("Rebuilding your wallet...");
      void refreshWallet();
    } catch (err) {
      setActionMessage(monitorMessage(err, "The rebuild could not be started. Please try again."));
    } finally {
      setWorking(false);
    }
  };

  const restoreFailed =
    status.restore && status.restore.state === "failed" && !restoreDismissed ? (
      <Box tone="warning" testId="banner-restore-failed">
        <Lead title="Your backup could not be restored.">{status.restore.message} Your wallet was not changed. Please try again.</Lead>
        <div>
          <Button variant="secondary" size="sm" onClick={() => setRestoreDismissed(true)}>
            OK
          </Button>
        </div>
      </Box>
    ) : null;

  const banner = renderState(status);
  if (!banner && !restoreFailed) return null;
  return (
    <section aria-label="Wallet status" className="mb-6 flex flex-col gap-3">
      {restoreFailed}
      {banner}
    </section>
  );

  function renderState(s: WalletStatus): ReactNode {
    const encrypted = !!s.migration?.encrypted;
    const message = actionMessage && <p role="status">{actionMessage}</p>;

    if (s.state === "migrating") {
      return (
        <Box tone="accent" testId="banner-migrating">
          <Lead title="Upgrading your wallet to the new Qtum wallet format.">
            This happens once and takes a few minutes. A copy of your old wallet was saved first, so your coins are safe.
            {encrypted ? "" : " Staking starts again by itself when the upgrade is done."}
          </Lead>
        </Box>
      );
    }

    if (s.state === "rebuilding") {
      const step = s.rebuild?.step;
      const progress = typeof s.rebuild?.progress === "number" ? `: ${s.rebuild.progress} %` : "";
      return (
        <Box tone="accent" testId="banner-rebuilding">
          <Lead title="Rebuilding your wallet from the copy of your old wallet.">
            This can take a few hours. Your old wallet stays on your AVADO, so your coins are safe.
            {encrypted ? "" : " Staking starts again by itself when it is done."}
          </Lead>
          {step && (
            <p data-testid="rebuild-step">
              {step}
              {progress}
            </p>
          )}
        </Box>
      );
    }

    if (s.state === "restoring") {
      return (
        <Box tone="accent" testId="banner-restoring">
          <Lead title="Restoring your wallet backup.">This takes a few minutes. Your previous wallet was saved on your AVADO first.</Lead>
        </Box>
      );
    }

    if (s.state === "needs-passphrase") {
      // The password was asked for by a rebuild, not by the upgrade.
      const forRebuild = s.rebuild?.state === "needs-passphrase";
      return (
        <Box tone="warning" testId="banner-needs-passphrase">
          <Lead title="Your wallet is protected with a password.">
            Enter it once to {forRebuild ? "rebuild your wallet in" : "finish the upgrade to"} the new Qtum wallet format. Your coins are safe. {LOCKED_NOTE}
          </Lead>
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (!passphrase) return;
              void (forRebuild ? rebuild(true) : retryUpgrade(true));
            }}
          >
            <Input
              type="password"
              label="Wallet password"
              autoComplete="off"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="sm:max-w-xs sm:flex-1"
            />
            <Button type="submit" size="md" disabled={!passphrase} loading={working}>
              {forRebuild ? "Rebuild wallet" : "Finish upgrade"}
            </Button>
          </form>
          {message}
        </Box>
      );
    }

    if (s.state === "failed" && s.problem === "wallet-missing") {
      return (
        <Box tone="danger" testId="banner-wallet-missing">
          <Lead title="Your wallet file is missing.">
            Your coins are safe: copies of your wallet are kept on your AVADO, and no new, empty wallet was made in its place. Staking is paused. Please
            contact AVADO support.
          </Lead>
          <div>
            <DetailsToggle open={showDetails} onToggle={() => setShowDetails(!showDetails)} />
          </div>
          {showDetails && <p className="text-xs text-fg-muted">{s.message}</p>}
        </Box>
      );
    }

    if (s.state === "failed") {
      const upgradeFailed = s.migration?.state === "failed";
      const canRebuild = upgradeFailed && s.migration?.canRebuild !== false;
      const rebuildFailed = upgradeFailed && !!s.rebuild && ["failed", "interrupted"].includes(s.rebuild.state);
      return (
        <Box tone="danger" testId="banner-failed">
          {rebuildFailed ? (
            <Lead title="Your wallet could not be rebuilt.">
              Your coins are safe: your old wallet was not changed and a copy of it is kept on your AVADO. Staking is paused until your wallet is in the new
              Qtum wallet format.
            </Lead>
          ) : upgradeFailed ? (
            <Lead title="Your wallet could not be upgraded to the new Qtum wallet format.">
              Your coins are safe: a copy of your old wallet is kept on your AVADO. Staking is paused until the upgrade works.
            </Lead>
          ) : (
            <Lead title="There is a problem with your Qtum wallet.">Your coins are safe. Please try again, or restart the Qtum package.</Lead>
          )}
          <div className="flex flex-wrap gap-2">
            {upgradeFailed && (
              <Button variant="secondary" size="sm" onClick={() => void retryUpgrade(false)} disabled={working}>
                Try again
              </Button>
            )}
            {canRebuild && (
              <Button variant="secondary" size="sm" onClick={() => setConfirmRebuild(true)} disabled={working}>
                Rebuild the wallet from the old copy
              </Button>
            )}
            <DetailsToggle open={showDetails} onToggle={() => setShowDetails(!showDetails)} />
          </div>
          {canRebuild && confirmRebuild && (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4" data-testid="rebuild-confirm">
              <p>
                This reads every key from the copy of your old wallet, creates a new wallet in the new format with the same keys, and checks that nothing is
                missing before it is used. Your old wallet stays on the AVADO. Scanning the blockchain can take a few hours.{" "}
                {encrypted
                  ? "Your wallet has a password: you are asked for it before the keys are read, and the new wallet stays locked and does not stake, as after the upgrade."
                  : "When it is done, staking starts again by itself. If your wallet has a password, you are asked for it first, and the new wallet then stays locked and does not stake, as after the upgrade."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" size="sm" onClick={() => void rebuild(false)} loading={working}>
                  Rebuild
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setConfirmRebuild(false)} disabled={working}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {showDetails && <p className="text-xs text-fg-muted">{s.message}</p>}
          {message}
          <p className="text-xs text-fg-muted">If this keeps happening, please contact AVADO support.</p>
        </Box>
      );
    }

    if (s.state === "ready" && s.newBackupRequired) {
      const rebuilt = s.migration?.method === "rebuild";
      const notCarriedOver = rebuilt && s.rebuild ? s.rebuild.notCarriedOver : "";
      return (
        <Box tone="warning" testId="banner-new-backup">
          <Lead title={`Your wallet was ${rebuilt ? "rebuilt in" : "upgraded to"} the new Qtum wallet format.`}>
            Please download a fresh backup now and keep it somewhere safe. Backups made before the {rebuilt ? "rebuild" : "upgrade"} do not include the new
            wallet format.
          </Lead>
          {rebuilt && s.rebuild?.source === "raw-pages" && (
            <p data-testid="damaged-note">
              {s.rebuild.seedRestored
                ? "The old wallet file was damaged; the keys that could be read were carried over and all addresses from its seed were restored."
                : "The old wallet file was damaged; the keys that could be read were carried over."}
            </p>
          )}
          {notCarriedOver && <p>{notCarriedOver}</p>}
          {encrypted && <p>{LOCKED_NOTE}</p>}
          <BackupButton label="Download wallet backup" />
        </Box>
      );
    }

    return null;
  }
}

export default WalletBanner;
