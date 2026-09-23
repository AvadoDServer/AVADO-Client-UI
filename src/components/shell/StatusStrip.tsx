import type { ReactNode } from "react";
import { useClientConfig } from "../../config/ClientConfigProvider";
import { useMode } from "../../settings/ModeProvider";
import { Skeleton, StatusPill } from "../ui";
import { CLIENT_TITLE } from "./identity";
import { describeHealth, type NodeStatus } from "./nodeStatus";

const fmt = (n: number) => n.toLocaleString("en-US");

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words font-medium tabular-nums text-fg">{children}</dd>
    </div>
  );
}

/**
 * Node status in plain words (spec §4): health, peers and client version;
 * Advanced adds inbound/outbound peers and the head slot. The data comes
 * from the shell's poll so the banners can share it.
 */
export function StatusStrip({ status, loading }: { status: NodeStatus | undefined; loading?: boolean }) {
  const { client } = useClientConfig();
  const { isAdvanced } = useMode();
  const health = describeHealth(status);
  const ready = status && status.health !== "not_ready";

  return (
    <section aria-label="Node status" className="border-b border-border bg-chrome px-4 py-3 sm:px-6 lg:px-8">
      <dl className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-sm">
        <div className="flex items-center">
          <dt className="sr-only">Status</dt>
          <dd>
            {loading && !status ? <Skeleton className="h-5 w-24" /> : <StatusPill status={health} />}
          </dd>
        </div>
        {status?.health === "not_ready" && (
          <p className="text-fg-muted">{CLIENT_TITLE[client]} is starting or stopped. This can take a few minutes.</p>
        )}
        {ready && status.peers !== undefined && <Item label="Peers">{fmt(status.peers)}</Item>}
        {ready && status.version && (
          <Item label="Version">
            {CLIENT_TITLE[client]} {status.version}
          </Item>
        )}
        {ready && isAdvanced && status.inbound !== undefined && status.outbound !== undefined && (
          <Item label="Inbound / outbound">
            {fmt(status.inbound)} / {fmt(status.outbound)}
          </Item>
        )}
        {ready && isAdvanced && status.syncing && (
          <Item label="Head slot">{fmt(Number(status.syncing.head_slot))}</Item>
        )}
      </dl>
    </section>
  );
}

export default StatusStrip;
