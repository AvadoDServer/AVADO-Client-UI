import { useState, type FormEvent } from "react";
import { Button, Input, Modal, Select } from "../../../../components/ui";
import { isQtumApiError, plainError } from "../../api/errors";
import { listAddresses } from "../../api/node";
import { useQtumApi } from "../../api/QtumApiProvider";
import { useRead } from "../../api/useRead";
import { CopyButton, ExternalLink, LoadError, LoadingLines, Notice, PageHeader, SectionCard, TechDetails } from "../../components/common";
import { WEB_WALLET_URL } from "../../lib/links";
import { useAppStatus } from "../../status/AppStatus";

export { WEB_WALLET_URL };
export const LOG_LINES = 200;
export const LOG_READ_MS = 10_000;
export const KEY_WARNING = "Anyone who has this key can take the coins on this address. Never share it and never type it into a website you do not trust.";

const monitorMessage = (err: unknown, fallback: string) => (isQtumApiError(err) && err.kind === "http" && err.detail ? err.detail : fallback);

function PrivateKey({ enabled }: { enabled: boolean }) {
  const api = useQtumApi();
  const addresses = useRead(listAddresses, { enabled, intervalMs: 60_000 });
  const [chosen, setChosen] = useState("");
  const [shown, setShown] = useState<{ address: string; key: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<{ text: string; error: unknown } | null>(null);
  const list = addresses.data ?? [];
  const address = chosen || list[0]?.address || "";

  const show = async (e: FormEvent) => {
    e.preventDefault();
    if (!address) return;
    setWorking(true);
    setError(null);
    try {
      setShown({ address, key: await api.privateKey(address) });
    } catch (err) {
      setError({ text: monitorMessage(err, "The private key could not be shown. Please try again."), error: err });
    } finally {
      setWorking(false);
    }
  };

  return (
    <SectionCard
      title="Show a private key"
      description="The private key of one address, for example to move it to another wallet. Only do this if you know why you need it."
      testId="private-key"
    >
      {!enabled ? (
        <p className="text-sm text-fg-muted">Shows here once your wallet is ready.</p>
      ) : addresses.error !== undefined && !addresses.data ? (
        <LoadError what="your addresses" error={addresses.error} onRetry={() => void addresses.refresh()} />
      ) : !addresses.data ? (
        <LoadingLines />
      ) : list.length === 0 ? (
        <p className="text-sm text-fg-muted">Your wallet has no addresses yet. Make one on the Wallet page.</p>
      ) : (
        <form onSubmit={show} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Select label="Address" value={address} onChange={(e) => setChosen(e.target.value)} className="min-w-0 sm:flex-1">
            {list.map((a) => (
              <option key={a.address} value={a.address}>
                {a.label ? `${a.label}: ${a.address}` : a.address}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary" loading={working}>
            Show private key
          </Button>
        </form>
      )}
      {error && (
        <Notice tone="danger" live testId="private-key-error">
          <p>{error.text}</p>
          <TechDetails error={error.error} />
        </Notice>
      )}
      <Modal
        open={!!shown}
        onClose={() => setShown(null)}
        title="Private key"
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setShown(null)}>
            Close
          </Button>
        }
      >
        {shown && (
          <div className="flex flex-col gap-4 text-sm" data-testid="private-key-shown">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Address</p>
              <p className="break-all font-mono">{shown.address}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Private key</p>
              <p className="break-all font-mono" data-testid="private-key-value">
                {shown.key}
              </p>
              <div className="mt-2">
                <CopyButton text={shown.key} label="Copy the key" />
              </div>
            </div>
            <Notice tone="danger">
              <p>{KEY_WARNING}</p>
            </Notice>
          </div>
        )}
      </Modal>
    </SectionCard>
  );
}

const IMPORTING = "Importing: your wallet is searching the Qtum blockchain for this key's coins";
const IMPORT_TAIL = "This can take a few hours. You can close this page; the import continues.";

function ImportKey() {
  const api = useQtumApi();
  const { walletStatus, refreshWallet } = useAppStatus();
  const [key, setKey] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<{ text: string; error: unknown } | null>(null);
  const [started, setStarted] = useState(false);
  const imp = walletStatus?.import ?? null;
  const running = imp?.state === "running";
  const scanning = walletStatus?.scanning;
  const progress = scanning && typeof scanning.progress === "number" ? ` (${Math.round(scanning.progress * 100)}% done)` : "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    setWorking(true);
    setError(null);
    try {
      await api.importKey(key.trim());
      setStarted(true);
      void refreshWallet();
    } catch (err) {
      setError({ text: monitorMessage(err, "The private key could not be imported. Please try again."), error: err });
    } finally {
      // The key is never kept in the page.
      setKey("");
      setWorking(false);
    }
  };

  return (
    <SectionCard title="Import a private key" description="Adds the coins of a private key to your wallet. Do not forget to back up your wallet after importing." testId="import-key">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Input
          type="password"
          label="Private key"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste the private key"
          value={key}
          disabled={running}
          onChange={(e) => setKey(e.target.value)}
          className="min-w-0 sm:flex-1"
        />
        <Button type="submit" variant="secondary" disabled={running || !key.trim()} loading={working}>
          Import
        </Button>
      </form>
      {running ? (
        <Notice tone="accent" live testId="import-status">
          <p>
            {IMPORTING}
            {progress}. {IMPORT_TAIL}
          </p>
        </Notice>
      ) : started && imp?.state === "done" ? (
        <Notice tone="success" live testId="import-status">
          <p>The private key was imported. Please download a fresh wallet backup.</p>
        </Notice>
      ) : started && imp?.state === "failed" ? (
        <Notice tone="danger" live testId="import-status">
          <p>The private key could not be imported: {imp.message}</p>
        </Notice>
      ) : started ? (
        <Notice tone="accent" live testId="import-status">
          <p>
            {IMPORTING}. {IMPORT_TAIL}
          </p>
        </Notice>
      ) : null}
      {error && (
        <Notice tone="danger" live testId="import-error">
          <p>{error.text}</p>
          <TechDetails error={error.error} />
        </Notice>
      )}
    </SectionCard>
  );
}

function NodeLog() {
  const logs = useRead((api) => api.logs(LOG_LINES), { intervalMs: LOG_READ_MS });
  return (
    <SectionCard
      title="Node log"
      description={`The last ${LOG_LINES} lines the Qtum node wrote. Anything that could be a key is hidden. Useful when AVADO support asks for it.`}
      actions={
        <Button variant="secondary" size="sm" onClick={() => void logs.refresh()}>
          Refresh
        </Button>
      }
      testId="node-log"
    >
      {logs.data ? (
        logs.data.length === 0 ? (
          <p className="text-sm text-fg-muted">The node has not written anything yet.</p>
        ) : (
          <pre
            className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-lg bg-bg-inset p-3 font-mono text-xs leading-relaxed text-fg [overflow-wrap:anywhere]"
            data-testid="log-lines"
            tabIndex={0}
            aria-label="Node log lines"
          >
            {logs.data.join("\n")}
          </pre>
        )
      ) : logs.error !== undefined ? (
        <LoadError what="the node log" error={logs.error} onRetry={() => void logs.refresh()} />
      ) : (
        <LoadingLines />
      )}
      {logs.data && logs.error !== undefined && <p className="text-xs text-fg-muted">Could not refresh the log: {plainError(logs.error)}</p>}
    </SectionCard>
  );
}

/** Advanced (spec): private keys, key import, the node log and the Qtum Web Wallet. */
export default function AdvancedPage() {
  const { walletReady, node, nodeError } = useAppStatus();
  const canRead = walletReady && !!node && nodeError === undefined;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Advanced" />
      <PrivateKey enabled={canRead} />
      <ImportKey />
      <NodeLog />
      <SectionCard
        title="Qtum Web Wallet"
        description="To send coins, or for tokens and smart contracts, use the Qtum Web Wallet. It opens in a new tab."
        testId="web-wallet"
      >
        <div>
          <ExternalLink href={WEB_WALLET_URL}>Qtum Web Wallet (advanced)</ExternalLink>
        </div>
      </SectionCard>
    </div>
  );
}
