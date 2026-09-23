import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "../../api/ApiProvider";
import type { ServiceAction } from "../../api/types";
import { Button, Card, CardDescription, CardHeader, CardTitle, ConfirmDialog, StatusPill, Table, TBody, TD, TH, THead, TR } from "../../components/ui";
import { useClientConfig } from "../../config/ClientConfigProvider";
import { logsToHtml } from "./logsToHtml";
import { POLL_MS, usePoll } from "../../hooks/usePoll";
import { processDetail, processStatus } from "./serviceStatus";

// Spec §3: service status and logs every 5 s, only while this page is open
// (the polls stop when it unmounts) and the tab is visible.
const LOG_TAIL_LINES = 200;

const ACTION_LABEL: Record<ServiceAction, string> = { start: "Start", stop: "Stop", restart: "Restart" };

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * Advanced page: service start/stop/restart (with a confirm on stop),
 * process status, live logs through DAPPMANAGER, and a link to the Admin
 * package page. Spec §4 "Advanced"; behaviour ported from the Nimbus
 * wizard's `AdminPage.tsx` + `shared/Logs.tsx` (nimbus.md §4.3).
 */
export default function AdvancedPage() {
  const api = useApi();
  const config = useClientConfig();

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const status = usePoll(() => api.backend.serviceStatus(), POLL_MS.service);
  const processes = status.data ?? null;
  const statusError = status.error === undefined ? null : errorMessage(status.error, "Could not load the process status.");

  const logsPoll = usePoll(() => api.dappmanager.logs(config.packageName, LOG_TAIL_LINES), POLL_MS.logs, { key: config.packageName });
  const logs = logsPoll.data;
  const logsError = logsPoll.error === undefined ? null : errorMessage(logsPoll.error, "Could not load the logs.");

  const [pendingAction, setPendingAction] = useState<ServiceAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmStopOpen, setConfirmStopOpen] = useState(false);

  const refreshStatus = status.refresh;

  const runAction = useCallback(
    async (action: ServiceAction) => {
      setPendingAction(action);
      setActionError(null);
      try {
        await api.backend.service(action);
        await refreshStatus();
      } catch (e) {
        if (mountedRef.current) setActionError(errorMessage(e, `Could not ${action} the service.`));
      } finally {
        if (mountedRef.current) setPendingAction(null);
      }
    },
    [api, refreshStatus],
  );

  const requestStop = () => setConfirmStopOpen(true);
  const cancelStop = () => setConfirmStopOpen(false);
  const confirmStop = async () => {
    setConfirmStopOpen(false);
    await runAction("stop");
  };

  // Auto-scroll the log panel to the bottom on new content, but only while
  // the owner hasn't scrolled up to read earlier lines.
  const terminalRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const onTerminalScroll = () => {
    const el = terminalRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  };
  // Loading (no answer yet), failed before any answer, empty, or lines.
  const logsPlaceholder =
    logs === undefined ? (logsPoll.loading ? "Loading logs…" : "No logs to show.") : logs.trim() === "" ? "No log output yet." : null;
  const logsHtml = useMemo(() => (logs && logs.trim() !== "" ? logsToHtml(logs) : ""), [logs]);
  useEffect(() => {
    const el = terminalRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [logsHtml]);

  const adminUrl = `http://my.ava.do/#/packages/${config.packageName}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Advanced</h1>
        <p className="mt-1 text-sm text-fg-muted">Service control, process status and live logs.</p>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Service</CardTitle>
            <CardDescription>Start, stop or restart the client service.</CardDescription>
          </div>
        </CardHeader>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            onClick={() => runAction("start")}
            loading={pendingAction === "start"}
            disabled={pendingAction !== null}
          >
            {ACTION_LABEL.start}
          </Button>
          <Button
            variant="secondary"
            onClick={() => runAction("restart")}
            loading={pendingAction === "restart"}
            disabled={pendingAction !== null}
          >
            {ACTION_LABEL.restart}
          </Button>
          <Button variant="danger" onClick={requestStop} loading={pendingAction === "stop"} disabled={pendingAction !== null}>
            {ACTION_LABEL.stop}
          </Button>
        </div>
        {actionError && (
          <p role="alert" className="mt-3 text-sm text-danger-text">
            {actionError}
          </p>
        )}
      </Card>

      <Card padding="none">
        <div className="px-5 pt-5">
          <CardTitle>Process status</CardTitle>
        </div>
        <div className="p-5">
          {statusError ? (
            <p role="alert" className="text-sm text-danger-text">
              {statusError}
            </p>
          ) : processes === null ? (
            <p className="text-sm text-fg-muted">Loading process status…</p>
          ) : processes.length === 0 ? (
            <p className="text-sm text-fg-muted">No processes reported.</p>
          ) : null}
        </div>
        {processes && processes.length > 0 && (
          <Table>
            <THead>
              <TR>
                <TH>Process</TH>
                <TH>Status</TH>
                <TH>Details</TH>
              </TR>
            </THead>
            <TBody>
              {processes.map((p) => (
                <TR key={p.name}>
                  <TD className="font-medium">{p.name}</TD>
                  <TD>
                    <StatusPill status={processStatus(p.statename)} />
                  </TD>
                  <TD className="font-mono text-xs text-fg-muted">{processDetail(p)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Logs</CardTitle>
            <CardDescription>The last {LOG_TAIL_LINES} lines, refreshed every 5 seconds while this page is open.</CardDescription>
          </div>
        </CardHeader>
        {logsError && (
          <p role="alert" className="mb-3 text-sm text-danger-text">
            {logsError}
          </p>
        )}
        {/* Forcing the dark token palette on this subtree (theme.css scopes
            "[data-theme=dark]" beyond just <html>) keeps ANSI colour codes
            legible: their fixed palette assumes a dark background in either
            app theme, the same reason terminal panes in CI log viewers stay
            dark regardless of site theme. */}
        <div
          ref={terminalRef}
          onScroll={onTerminalScroll}
          data-theme="dark"
          tabIndex={0}
          aria-label="Live logs"
          className="h-96 overflow-auto rounded-lg border border-border bg-bg-inset p-4 focus:outline-none focus-visible:shadow-focus"
        >
          {logsPlaceholder !== null ? (
            <p className="font-mono text-xs text-fg-muted" aria-live="polite">
              {logsPlaceholder}
            </p>
          ) : (
            <pre
              className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-fg"
              // logsToHtml HTML-escapes plain text before adding ANSI styling spans (see its own comment).
              dangerouslySetInnerHTML={{ __html: logsHtml }}
            />
          )}
        </div>
      </Card>

      <Card>
        <CardTitle>Admin package page</CardTitle>
        <CardDescription>Manage backups, environment variables and more from the AVADO Admin.</CardDescription>
        <Button as="a" href={adminUrl} target="_blank" rel="noopener noreferrer" variant="outline" className="mt-4">
          Open in Admin
        </Button>
      </Card>

      <ConfirmDialog
        open={confirmStopOpen}
        title="Stop the service?"
        tone="danger"
        confirmLabel="Stop"
        cancelLabel="Cancel"
        loading={pendingAction === "stop"}
        onConfirm={confirmStop}
        onCancel={cancelStop}
      >
        Stopping interrupts syncing and attesting until you start it again.
      </ConfirmDialog>
    </div>
  );
}
