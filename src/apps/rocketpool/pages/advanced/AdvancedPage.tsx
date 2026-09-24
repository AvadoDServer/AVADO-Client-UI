import { useEffect, useRef, useState } from "react";
import { Button, Select, StatusPill } from "../../../../components/ui";
import { usePoll } from "../../../../hooks/usePoll";
import { plainError } from "../../api/errors";
import { reconcileStatusOf } from "../../api/reconcile";
import { useRocketpoolApi } from "../../api/RocketpoolApiProvider";
import { getGasPrice, getVersion } from "../../api/sn";
import { useRead } from "../../api/useRead";
import { formatDateTime, parseTime } from "../../lib/time";
import { formatGwei } from "../../lib/units";
import { useAppStatus } from "../../status/AppStatus";
import { serviceStatus } from "../../status/daemon";
import { DEFAULT_PRIORITY_FEE_WEI } from "../../tx/gas";
import { Callout, Facts, PageHeader, SectionCard } from "../common";
import { AUTOMATIC_ACTIONS, daemonSettings, underThreshold } from "./automatic";

/** Advanced: the daemon, versions, automatic actions and their gas limits, gas, the key check, and the logs. */
export default function AdvancedPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Advanced" description="The Rocket Pool service, what it does by itself, gas, the key check and the logs." />
      <Service />
      <AutomaticActions />
      <KeyCheck />
      <Logs />
    </div>
  );
}

const ts = (iso: string | null | undefined) => {
  const t = parseTime(iso ?? null);
  return t === null ? "—" : formatDateTime(t);
};

function Service() {
  const status = useAppStatus();
  const { avado, daemonReady } = status;
  const version = useRead(getVersion, { enabled: daemonReady, intervalMs: 10 * 60_000 });
  return (
    <SectionCard title="Rocket Pool service" data-testid="service">
      <div>
        <StatusPill status={serviceStatus(status)} />
        {avado?.daemon.description && <p className="mt-1 text-xs text-fg-muted">{avado.daemon.description}</p>}
      </div>
      <Facts
        items={[
          { label: "Package version", value: avado?.packageVersion ?? "—" },
          { label: "Smartnode version", value: version.data?.version ?? (daemonReady ? "…" : "—") },
          { label: "Network", value: avado ? avado.network : "—" },
          { label: "Running since", value: ts(avado?.daemon.since) },
          { label: "Smartnode API", value: avado ? (avado.apiReachable ? "Answering" : "Not answering") : "—" },
        ]}
      />
      {avado?.startupError && (
        <Callout tone="danger" title="Rocket Pool could not start" role="alert">
          <p className="break-words">{avado.startupError}</p>
        </Callout>
      )}
      {avado && avado.daemonErrors.length > 0 && (
        <div>
          <p className="text-sm font-medium text-fg">Recent errors</p>
          <ul className="mt-1 flex flex-col gap-1 font-mono text-xs text-fg-muted">
            {avado.daemonErrors.slice(-5).map((l, i) => (
              <li key={i} className="break-all">
                {l}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function AutomaticActions() {
  const { avado, daemonReady } = useAppStatus();
  const gas = useRead(getGasPrice, { enabled: daemonReady, intervalMs: 30_000 });
  const { values, reported } = daemonSettings(avado);
  const under = underThreshold(gas.data?.gasPrice, values.autoTxGasThreshold);
  const base = gas.data?.gasPrice;
  return (
    <>
      <SectionCard
        title="Automatic actions"
        description="Your Rocket Pool node sends these transactions by itself, paid from the node wallet."
        data-testid="automatic-actions"
      >
        <ul className="flex flex-col gap-3">
          {AUTOMATIC_ACTIONS.map((a) => (
            <li key={a.title} className="text-sm">
              <p className="font-medium text-fg">{a.title}</p>
              <p className="text-fg-muted">{a.text}</p>
            </li>
          ))}
        </ul>
        <Facts
          items={[
            {
              label: "Gas limit for automatic actions",
              value: `${values.autoTxGasThreshold} gwei`,
              hint: "They wait while the network's fee is above this.",
            },
            { label: "Minipool balance paid out automatically above", value: `${values.distributeThreshold} ETH` },
            { label: "Tip on automatic actions", value: `${values.priorityFee} gwei` },
          ]}
        />
        <Callout tone="neutral">
          <p>
            In practice they go ahead soon after they are needed: the network fee on Ethereum is usually well below {values.autoTxGasThreshold}{" "}
            gwei.
            {base !== undefined && under !== null && (
              <>
                {" "}
                Right now the base fee is {formatGwei(base)},{" "}
                {under ? "below the limit, so automatic actions go ahead." : "above the limit, so automatic actions wait."}
              </>
            )}
          </p>
        </Callout>
        {!reported && <p className="text-xs text-fg-muted">These are the package's settings, applied on every start.</p>}
      </SectionCard>

      <SectionCard title="Gas for transactions you confirm" description="What this app sends with the transactions you confirm here.">
        <Facts
          items={[
            { label: "Current base fee", value: base !== undefined ? formatGwei(base) : daemonReady ? "…" : "—" },
            { label: "Tip for the block builder", value: formatGwei(DEFAULT_PRIORITY_FEE_WEI) },
            { label: "Max fee per gas", value: "2 × base fee + tip", hint: "Room for the fee to rise for two full blocks; unused fee is never charged." },
          ]}
        />
        {gas.error !== undefined && <p className="text-sm text-danger-text">{plainError(gas.error)}</p>}
      </SectionCard>
    </>
  );
}

function KeyCheck() {
  const api = useRocketpoolApi();
  const { reconcile, refresh } = useAppStatus();
  const status = reconcile ? reconcileStatusOf(reconcile) : undefined;
  const [asked, setAsked] = useState<"idle" | "busy" | "asked" | { error: string }>("idle");
  const ask = async () => {
    setAsked("busy");
    try {
      await api.requestReconcile();
      setAsked("asked");
      void refresh();
    } catch (e) {
      setAsked({ error: plainError(e) });
    }
  };
  return (
    <SectionCard
      title="Validator key check"
      description="Every 5 minutes the package checks that your validator keys are loaded in your consensus client, with the right fee recipient."
      actions={
        <Button variant="secondary" size="sm" onClick={ask} loading={asked === "busy"} disabled={asked === "busy"}>
          Check now
        </Button>
      }
      data-testid="key-check"
    >
      {!status ? (
        <p className="text-sm text-fg-muted">{reconcile?.error ?? "The first check hasn't finished yet."}</p>
      ) : (
        <>
          <p className="text-sm text-fg">{status.message}</p>
          <Facts
            items={[
              { label: "Consensus client", value: status.client?.name ?? "None found" },
              { label: "Keys loaded", value: status.keys.total > 0 ? `${status.keys.inSync} of ${status.keys.total}` : "—" },
              { label: "Fee recipients", value: status.feeRecipients.total > 0 ? `${status.feeRecipients.ok + status.feeRecipients.fixed} of ${status.feeRecipients.total} correct` : "—" },
              { label: "Last check", value: ts(status.finishedAt) },
              { label: "Next check", value: ts(status.nextRunAt) },
            ]}
          />
          {status.errors.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-fg">
              {status.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {asked === "asked" && (
        <p className="text-sm text-fg-muted" role="status">
          A check was asked for. It runs within a minute; this page updates by itself.
        </p>
      )}
      {typeof asked === "object" && (
        <p className="text-sm text-danger-text" role="alert">
          {asked.error}
        </p>
      )}
    </SectionCard>
  );
}

const TAILS = [200, 500, 2000] as const;

function Logs() {
  const api = useRocketpoolApi();
  const [tail, setTail] = useState<number>(200);
  const logs = usePoll(() => api.logs(tail), 5_000, { key: tail });
  const box = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  const lines = logs.data?.lines;
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <SectionCard
      title="Logs"
      description="The Rocket Pool daemon's latest lines. Secrets are removed before they reach this page."
      actions={
        <Select aria-label="Lines to show" inputSize="sm" value={String(tail)} onChange={(e) => setTail(Number(e.target.value))}>
          {TAILS.map((n) => (
            <option key={n} value={n}>
              Last {n} lines
            </option>
          ))}
        </Select>
      }
      data-testid="logs"
    >
      {logs.error !== undefined && !logs.data && <p className="text-sm text-danger-text">{plainError(logs.error)}</p>}
      {logs.data && !logs.data.available && <p className="text-sm text-fg-muted">There is no log yet.</p>}
      {logs.data?.available && (
        <pre
          ref={box}
          tabIndex={0}
          aria-label="Daemon log"
          onScroll={() => {
            const el = box.current;
            if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
          }}
          className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-bg-inset p-3 font-mono text-xs leading-5 text-fg focus:outline-none focus-visible:shadow-focus"
        >
          {logs.data.lines.length ? logs.data.lines.join("\n") : "No log lines yet."}
        </pre>
      )}
      {logs.loading && !logs.data && <p className="text-sm text-fg-muted">Loading the logs…</p>}
    </SectionCard>
  );
}
