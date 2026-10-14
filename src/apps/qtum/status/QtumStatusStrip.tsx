import type { ReactNode } from "react";
import { Skeleton, StatusPill } from "../../../components/ui";
import { isMock } from "../api/QtumApiProvider";
import { formatCount } from "../lib/format";
import { useAppStatus } from "./AppStatus";

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words font-medium tabular-nums text-fg">{children}</dd>
    </div>
  );
}

/**
 * The node in plain words, like the client app's status strip: Running,
 * Syncing n %, Starting or Stopped; the block height (and how far the node
 * has to go while syncing), peers and the Qtum version.
 */
export function QtumStatusStrip() {
  const { node, nodeError, nodeView } = useAppStatus();
  const fresh = node && nodeError === undefined;
  return (
    <section
      aria-label="Node status"
      className="flex flex-wrap items-center gap-x-6 gap-y-1.5 border-b border-border bg-chrome px-4 py-3 text-sm sm:px-6 lg:px-8"
    >
      <dl className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
        <div className="flex items-center">
          <dt className="sr-only">Status</dt>
          <dd data-testid="node-state">{!node && nodeError === undefined ? <Skeleton className="h-5 w-24" /> : <StatusPill status={nodeView} />}</dd>
        </div>
        {fresh && (
          <Item label="Block">
            {formatCount(node.blocks)}
            {node.syncing && node.headers > node.blocks ? ` of ${formatCount(node.headers)}` : ""}
          </Item>
        )}
        {fresh && node.peers !== undefined && <Item label="Peers">{formatCount(node.peers)}</Item>}
        {fresh && node.version && <Item label="Version">Qtum {node.version}</Item>}
        {isMock() && (
          <div>
            <dt className="sr-only">Data</dt>
            <dd>
              <StatusPill status={{ tone: "accent", label: "Demo data" }} />
            </dd>
          </div>
        )}
      </dl>
      {!fresh && nodeView.hint && (
        <p className="min-w-0 text-fg-muted" data-testid="node-hint">
          {nodeView.hint}
        </p>
      )}
    </section>
  );
}
