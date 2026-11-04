import { useId, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../../api/ApiProvider";
import { Button, Card, CardDescription, CardTitle, StatusPill, cn, type StatusTone } from "../../components/ui";
import { adminPackageUrl } from "../../components/shell/links";
import { useClientConfig } from "../../config/ClientConfigProvider";
import { usePoll } from "../../hooks/usePoll";
import { clientDisplayName } from "../../lib/clientName";
import {
  LIDO_DOCS,
  LIDO_RELAYS_CHECKED,
  checkRelays,
  isLidoFeeRecipient,
  lidoNetwork,
  readDepositData,
  relayLabel,
  type LidoNetwork,
  type RelayCheck,
} from "../../lib/lido";
import { readFileText } from "../add/keystoreFiles";
import { ExternalIcon, validatorName } from "../validators/parts";
import { validatorStatusText } from "../validators/statusText";
import { useValidators, type ValidatorRowData } from "../validators/useValidators";
import { effectiveFeeRecipient, summariseLido, validators, type LidoSummary } from "./lidoStatus";

export const MEVBOOST_PACKAGE = "mevboost.avado.dnp.dappnode.eth";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Ext({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center gap-1 font-medium", className)}>
      {children}
      <ExternalIcon />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** An address shown in full, easy to select and compare. */
function Address({ value }: { value: string }) {
  return <span className="break-all rounded bg-fg/[0.06] px-1.5 py-0.5 font-mono text-xs text-fg">{value}</span>;
}

function Check({ tone, title, children, action }: { tone: StatusTone; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <StatusPill status={{ tone, label: <span className="font-semibold">{title}</span> }} />
        {children && <div className="pl-[1.125rem] text-sm text-fg-muted">{children}</div>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2 pl-[1.125rem] sm:pl-0">{action}</div>}
    </li>
  );
}

interface Outcome {
  ok: number;
  failed: string[];
}

/** Set (or clear) the fee recipient of several keys, one after the other. */
async function forEachKey(pubkeys: string[], fn: (pubkey: string) => Promise<void>): Promise<Outcome> {
  const out: Outcome = { ok: 0, failed: [] };
  for (const pk of pubkeys) {
    try {
      await fn(pk);
      out.ok += 1;
    } catch (e) {
      out.failed.push(errorText(e));
    }
  }
  return out;
}

/** "1 validator now sends its" / "2 validators now send their" … */
const outcomeText = (o: Outcome, done: (one: boolean) => string) => {
  const ok = o.ok > 0 ? `${validators(o.ok)} ${done(o.ok === 1)}.` : "";
  if (o.failed.length === 0) return ok;
  const failed = `${o.failed.length === 1 ? "1 validator didn't" : `${o.failed.length} validators didn't`} change: ${o.failed[0]}. Try again in a minute.`;
  return ok ? `${ok} ${failed}` : failed;
};
const NOW_LIDO = (one: boolean) => (one ? "now sends its block rewards to Lido" : "now send their block rewards to Lido");
const NOW_DEFAULT = (one: boolean) => (one ? "uses your default fee recipient again" : "use your default fee recipient again");
/** " 1 validator from the file isn't on this node." */
const missingText = (n: number) => (n > 0 ? ` ${validators(n)} from the file ${n === 1 ? "isn't" : "aren't"} on this node.` : "");

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

interface MevState {
  /** The client's MEV-Boost setting; undefined when the settings could not be read. */
  mevBoostOn: boolean | undefined;
  /** MEV-Boost's settings; null when it isn't installed, undefined when unknown. */
  envs: Record<string, string> | null | undefined;
}

function MevBoostCheck({ lido, mev, client }: { lido: LidoNetwork; mev: MevState | undefined; client: string }) {
  const manage = (
    <Button as="a" href={adminPackageUrl(MEVBOOST_PACKAGE)} size="sm" variant="secondary">
      Change relays
    </Button>
  );
  if (!mev || mev.mevBoostOn === undefined) {
    return <Check tone="neutral" title="MEV-Boost: can't check right now">This page tries again by itself.</Check>;
  }
  if (!mev.mevBoostOn) {
    return (
      <Check
        tone="warning"
        title="MEV-Boost is off"
        action={
          <Button as={Link} to="/settings" size="sm" variant="secondary">
            Open Settings
          </Button>
        }
      >
        Lido asks its node operators to build blocks through MEV-Boost with relays from Lido&apos;s list. Turn on MEV-Boost
        for {client} in Settings.
      </Check>
    );
  }
  if (!lido.relays) {
    return (
      <Check tone="neutral" title="MEV-Boost relays: not checked on this network">
        On a test network, use only the relays on Lido&apos;s test-network list.
      </Check>
    );
  }
  if (mev.envs === undefined) {
    return <Check tone="neutral" title="MEV-Boost relays: can't check right now">This page tries again by itself.</Check>;
  }
  if (mev.envs === null) {
    return (
      <Check tone="danger" title="MEV-Boost is on, but not installed">
        Install the MEV-Boost package from the store, or turn MEV-Boost off in Settings.
      </Check>
    );
  }
  const check: RelayCheck = checkRelays(mev.envs.RELAYS, lido.relays);
  const listNote = <> (Lido&apos;s list as of {LIDO_RELAYS_CHECKED}.)</>;
  switch (check.kind) {
    case "ok":
      return (
        <Check tone="success" title="MEV-Boost relays are on Lido's list">
          All {check.relays.length} relays MEV-Boost uses are allowed by Lido.{listNote}
        </Check>
      );
    case "none":
      return (
        <Check tone="danger" title="MEV-Boost has no relays" action={manage}>
          Choose relays from Lido&apos;s list in MEV-Boost.
        </Check>
      );
    case "no-must-use":
      return (
        <Check tone="warning" title="Add one of Lido's main relays" action={manage}>
          Lido asks you to use at least one of its main relays, for example Flashbots, Ultra Sound, Aestus or Agnostic.
          {listNote}
        </Check>
      );
    case "not-allowed":
      return (
        <Check tone="danger" title="Some relays are not on Lido's list" action={manage}>
          <p className="mb-1">
            Turn these off in MEV-Boost: {check.notAllowed.map(relayLabel).join(", ")}. A block from a relay Lido doesn&apos;t
            allow can cost you a penalty.{listNote}
          </p>
        </Check>
      );
  }
}

function FeeRecipientChecks({
  lido,
  summary,
  onFix,
  onUnLido,
  busy,
}: {
  lido: LidoNetwork;
  summary: LidoSummary;
  onFix: () => void;
  onUnLido: () => void;
  busy: "fix" | "unlido" | null;
}) {
  const n = summary.lido.length;
  return (
    <>
      {n === 0 ? (
        <Check tone="neutral" title="No Lido validators on this node yet">
          Follow the steps below to add your first one.
        </Check>
      ) : summary.wrongFee.length > 0 ? (
        <Check
          tone="danger"
          title={
            summary.wrongFee.length === 1
              ? "1 validator sends its block rewards to the wrong address"
              : `${summary.wrongFee.length} validators send their block rewards to the wrong address`
          }
          action={
            <Button size="sm" onClick={onFix} loading={busy === "fix"} disabled={busy !== null}>
              Send them to Lido
            </Button>
          }
        >
          {summary.wrongFee.map(validatorName).join(", ")}: Lido validators must send their block rewards (tips and MEV) to
          Lido&apos;s address <Address value={lido.elRewardsVault} />. Lido takes a penalty from your bond for every block that
          doesn&apos;t.
        </Check>
      ) : summary.feeUnknown.length === n ? (
        <Check tone="neutral" title={`${validators(n)} for Lido: fee recipient not known yet`}>
          The client didn&apos;t say where their block rewards go. This page tries again by itself.
        </Check>
      ) : (
        <Check tone="success" title={`${validators(n)} for Lido, block rewards go to Lido`}>
          Every Lido validator on this node sends its block rewards to Lido&apos;s address, as Lido requires.
        </Check>
      )}
      {summary.givingAway.length > 0 && (
        <Check
          tone="warning"
          title={
            summary.givingAway.length === 1
              ? "1 of your own validators gives its rewards to Lido"
              : `${summary.givingAway.length} of your own validators give their rewards to Lido`
          }
          action={
            summary.defaultIsLido ? (
              <Button as={Link} to="/settings?focus=fee-recipient" size="sm" variant="secondary">
                Change the default
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={onUnLido} loading={busy === "unlido"} disabled={busy !== null}>
                Use my default address
              </Button>
            )
          }
        >
          {summary.givingAway.map(validatorName).join(", ")} {summary.givingAway.length === 1 ? "is" : "are"} not a Lido
          validator but {summary.givingAway.length === 1 ? "sends its" : "send their"} block rewards to Lido.
          {summary.defaultIsLido && " Your default fee recipient in Settings is Lido's address: use your own address there."}
        </Check>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Deposit data (for keys added before)
// ---------------------------------------------------------------------------

function DepositDataPicker({
  lido,
  rows,
  defaultFeeRecipient,
  onDone,
}: {
  lido: LidoNetwork;
  rows: ValidatorRowData[];
  defaultFeeRecipient: string;
  onDone: () => void;
}) {
  const { keymanager } = useApi();
  const config = useClientConfig();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [found, setFound] = useState<{ name: string; onNode: string[]; missing: number } | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "fg" | "danger" } | null>(null);
  const [busy, setBusy] = useState(false);

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setFound(null);
    const text = await readFileText(f).catch(() => "");
    const r = readDepositData(text, config.network);
    if (r.kind === "not-deposit-data") {
      setMessage({ tone: "danger", text: `${f.name} isn't a deposit data file. It is called deposit_data-… .json.` });
      return;
    }
    if (r.kind === "wrong-network") {
      setMessage({ tone: "danger", text: `${f.name} is for ${r.fileNetwork}, but this node runs on ${config.network}.` });
      return;
    }
    if (r.kind === "not-lido") {
      setMessage({
        tone: "danger",
        text: `None of the keys in ${f.name} pays out to Lido. Lido keys must have Lido's withdrawal address.`,
      });
      return;
    }
    const node = new Map(rows.map((row) => [row.pubkey.toLowerCase(), row]));
    const onNode = r.lido.filter((pk) => node.has(pk));
    const todo = onNode.filter((pk) => {
      const row = node.get(pk);
      return !!row && !isLidoFeeRecipient(effectiveFeeRecipient(row, defaultFeeRecipient), config.network);
    });
    const missing = r.lido.length - onNode.length;
    if (onNode.length === 0) {
      setMessage({
        tone: "danger",
        text:
          r.lido.length === 1
            ? `The validator in ${f.name} isn't on this node yet. Add its keystore file first.`
            : `None of the ${r.lido.length} validators in ${f.name} is on this node yet. Add their keystore files first.`,
      });
      return;
    }
    if (todo.length === 0) {
      setMessage({
        tone: "fg",
        text: `${onNode.length === 1 ? `The validator from ${f.name} on this node already sends its` : `All ${onNode.length} validators from ${f.name} on this node already send their`} block rewards to Lido.${missingText(missing)}`,
      });
      return;
    }
    setMessage(null);
    setFound({ name: f.name, onNode: todo, missing });
  };

  const apply = async () => {
    if (!found) return;
    setBusy(true);
    const o = await forEachKey(found.onNode, (pk) => keymanager.setFeeRecipient(pk, lido.elRewardsVault));
    setBusy(false);
    setFound(null);
    setMessage({ tone: o.failed.length ? "danger" : "fg", text: outcomeText(o, NOW_LIDO) });
    onDone();
  };

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
          Choose the deposit data file
        </Button>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          onChange={(e) => void onPick(e)}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose the deposit data file"
        />
      </div>
      {found && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="mb-0 text-sm text-fg">
            {validators(found.onNode.length)} from {found.name} {found.onNode.length === 1 ? "is" : "are"} on this node and
            {found.onNode.length === 1 ? " doesn't" : " don't"} send block rewards to Lido yet.
            {missingText(found.missing)}
          </p>
          <Button size="sm" onClick={() => void apply()} loading={busy}>
            Send their rewards to Lido
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className={cn("mb-0 text-sm", message.tone === "danger" ? "text-danger-text" : "text-fg")}>
          {message.text}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4 py-4 first:pt-0 last:pb-0">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/[0.12] text-sm font-semibold text-accent"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="mb-1 text-base font-semibold text-fg">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h3>
        <div className="flex flex-col gap-2 text-sm text-fg-muted">{children}</div>
      </div>
    </li>
  );
}

function Header() {
  return (
    <header className="mb-6 flex flex-col gap-1 border-b border-border pb-5">
      <h1 className="mb-0 font-display text-4xl font-bold tracking-tight text-fg">Lido CSM</h1>
      <p className="mb-0 max-w-2xl text-sm text-fg-muted">
        Run validators for Lido&apos;s Community Staking Module on this node. Your first validator needs a bond of 2.4 ETH
        (1.5 ETH if Lido has verified you as an independent staker) instead of 32 ETH.
      </p>
    </header>
  );
}

export interface LidoPageProps {
  pollMs?: number;
  retryMs?: number;
}

/** The Lido CSM page: what it is, whether this node is set up right, and how to add Lido validators. */
export default function LidoPage({ pollMs, retryMs }: LidoPageProps = {}) {
  const api = useApi();
  const config = useClientConfig();
  const client = clientDisplayName(config.client);
  const lido = lidoNetwork(config.network);
  const { data, error, refresh } = useValidators(pollMs, retryMs);
  const mev = usePoll<MevState>(
    async () => {
      const [settings, envs] = await Promise.allSettled([api.backend.getSettings(), api.dappmanager.packageEnvs(MEVBOOST_PACKAGE)]);
      return {
        mevBoostOn: settings.status === "fulfilled" ? settings.value.mev_boost === true : undefined,
        envs: envs.status === "fulfilled" ? envs.value : undefined,
      };
    },
    pollMs ?? 60_000,
    { enabled: !!lido, retryMs },
  );
  const [busy, setBusy] = useState<"fix" | "unlido" | null>(null);
  const [result, setResult] = useState<{ text: string; failed: boolean } | null>(null);

  if (!lido) {
    return (
      <div className="min-w-0">
        <Header />
        <Card className="max-w-3xl">
          <CardTitle>Not on this network</CardTitle>
          <CardDescription>
            Lido CSM runs on Ethereum mainnet and on the Hoodi test network. This node runs on {config.network}.
          </CardDescription>
        </Card>
      </div>
    );
  }

  const rows = data?.rows ?? [];
  const defaultFeeRecipient = data?.defaultFeeRecipient ?? "";
  const summary = summariseLido(rows, config.network, defaultFeeRecipient);

  const fix = async () => {
    setBusy("fix");
    setResult(null);
    const o = await forEachKey(
      summary.wrongFee.map((r) => r.pubkey),
      (pk) => api.keymanager.setFeeRecipient(pk, lido.elRewardsVault),
    );
    setBusy(null);
    setResult({ text: outcomeText(o, NOW_LIDO), failed: o.failed.length > 0 });
    void refresh();
  };

  const unLido = async () => {
    setBusy("unlido");
    setResult(null);
    const o = await forEachKey(
      summary.givingAway.map((r) => r.pubkey),
      (pk) => api.keymanager.deleteFeeRecipient(pk),
    );
    setBusy(null);
    setResult({ text: outcomeText(o, NOW_DEFAULT), failed: o.failed.length > 0 });
    void refresh();
  };

  return (
    <div className="min-w-0">
      <Header />
      <div className="flex max-w-3xl flex-col gap-5">
        <Card>
          <CardTitle>How it works</CardTitle>
          <div className="mt-2 flex flex-col gap-2 text-sm text-fg-muted">
            <p className="mb-0">
              You run the validators on this node and Lido adds the 32 ETH stake for each one. You put up a bond: 2.4 ETH
              for the first validator and 1.3 ETH for each next one. If Lido has verified you as an independent staker, the
              first one needs 1.5 ETH.
            </p>
            <p className="mb-0">
              You earn a share of the rewards on the full 32 ETH, plus the rewards on your bond. If a validator works
              badly or breaks Lido&apos;s rules, Lido takes a penalty from the bond. When a validator exits, the 32 ETH goes
              back to Lido and you claim your bond in Lido&apos;s app.
            </p>
            <p className="mb-0 flex flex-wrap gap-x-4 gap-y-1">
              <Ext href={lido.csmUrl}>Lido&apos;s CSM app</Ext>
              <Ext href={LIDO_DOCS.csm}>Lido&apos;s CSM guide</Ext>
              <Ext href={LIDO_DOCS.penalties}>Penalties</Ext>
            </p>
          </div>
        </Card>

        <Card>
          <CardTitle>Is this node ready for Lido?</CardTitle>
          {!data && error ? (
            <p role="status" className="mt-3 mb-0 text-sm text-fg-muted">
              {client} isn&apos;t answering right now. This page tries again by itself.
            </p>
          ) : !data ? (
            <p role="status" className="mt-3 mb-0 text-sm text-fg-muted">
              Checking…
            </p>
          ) : (
            <ul aria-label="Lido checks" className="mt-4 flex flex-col divide-y divide-border">
              <FeeRecipientChecks lido={lido} summary={summary} onFix={() => void fix()} onUnLido={() => void unLido()} busy={busy} />
              <MevBoostCheck lido={lido} mev={mev.data} client={client} />
            </ul>
          )}
          {result && (
            <p role="status" className={cn("mt-3 mb-0 text-sm font-medium", result.failed ? "text-danger-text" : "text-fg")}>
              {result.text}
            </p>
          )}
        </Card>

        <Card>
          <CardTitle>Add Lido validators</CardTitle>
          <ol aria-label="Steps" className="mt-4 flex flex-col divide-y divide-border">
            <Step n={1} title="Make your validator keys">
              <p className="mb-0">
                Make the keys with Lido&apos;s guide, ideally on a computer that is not connected to the internet. Write the
                recovery phrase on paper and keep it safe.
              </p>
              <p className="mb-0">
                Choose regular (0x01) keys, 32 ETH each, and set the withdrawal address to Lido&apos;s address{" "}
                <Address value={lido.withdrawalVault} />. Keys with another withdrawal address can&apos;t join Lido.
              </p>
              <p className="mb-0">
                <Ext href={lido.keyGuideUrl}>Lido&apos;s key guide</Ext>
              </p>
            </Step>
            <Step n={2} title="Join Lido and add your bond">
              <p className="mb-0">
                Open Lido&apos;s CSM app, connect your wallet, upload the deposit data file (deposit_data-… .json) and add the
                bond. Lido deposits the 32 ETH for a key when it is that key&apos;s turn.
              </p>
              <p className="mb-0">
                <Ext href={lido.csmUrl}>Open Lido&apos;s CSM app</Ext>
              </p>
            </Step>
            <Step n={3} title="Add the keys to this node">
              <p className="mb-0">
                On Add validators, add the keystore files and the same deposit data file together. The keys in the deposit
                data then send their block rewards to Lido&apos;s address, as Lido requires.
              </p>
              <div>
                <Button as={Link} to="/add" size="sm">
                  Add validators
                </Button>
              </div>
              <p className="mb-0 mt-2">Added the keys before? Choose the deposit data file here to set them up for Lido.</p>
              <DepositDataPicker lido={lido} rows={rows} defaultFeeRecipient={defaultFeeRecipient} onDone={() => void refresh()} />
            </Step>
            <Step n={4} title="Watch for exit requests">
              <p className="mb-0">
                Lido can ask you to exit a validator. Do it within 4 days (5 days for verified independent stakers), with
                Exit on the Validators page, or Lido charges you. Lido&apos;s Telegram bot, CSM Sentinel, tells you when a
                request comes in.
              </p>
              <p className="mb-0 flex flex-wrap gap-x-4 gap-y-1">
                <Ext href={lido.sentinelUrl}>CSM Sentinel on Telegram</Ext>
                <Ext href={LIDO_DOCS.exits}>About exits</Ext>
              </p>
            </Step>
          </ol>
        </Card>

        {summary.lido.length > 0 && (
          <Card>
            <CardTitle>Your Lido validators</CardTitle>
            <ul aria-label="Lido validators" className="mt-3 flex flex-col divide-y divide-border">
              {summary.lido.map((row) => {
                const s = validatorStatusText(row.state);
                const fee = effectiveFeeRecipient(row, defaultFeeRecipient);
                const ok = isLidoFeeRecipient(fee, config.network);
                return (
                  <li key={row.pubkey} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                    <span className="font-medium text-fg">{validatorName(row)}</span>
                    <span className="flex flex-wrap items-center gap-4">
                      <StatusPill status={{ tone: s.tone, label: s.label }} />
                      <StatusPill
                        status={
                          row.feeRecipient === undefined
                            ? { tone: "neutral", label: "Fee recipient not known" }
                            : ok
                              ? { tone: "success", label: "Rewards to Lido" }
                              : { tone: "danger", label: "Rewards to the wrong address" }
                        }
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <Card>
          <CardTitle>Bond and rewards</CardTitle>
          <CardDescription>
            Your bond and rewards are in Lido&apos;s CSM app, under Bond &amp; Rewards. Rewards build up as stETH; you can claim
            them as ETH, stETH or wstETH.
          </CardDescription>
          <p className="mb-0 mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Ext href={lido.csmUrl}>Bond &amp; Rewards in Lido&apos;s app</Ext>
            <Ext href={LIDO_DOCS.bonds}>How bonds work</Ext>
          </p>
        </Card>
      </div>
    </div>
  );
}
