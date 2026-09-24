import { useEffect, useState, type ReactNode } from "react";
import { Button, StatusDot, cn } from "../../../components/ui";
import { addressUrl } from "../lib/explorer";

export type NoticeTone = "danger" | "warning" | "success" | "accent" | "neutral";

const NOTICE_BOX: Record<NoticeTone, string> = {
  danger: "border-danger/25 bg-danger-subtle",
  warning: "border-warning/25 bg-warning-subtle",
  success: "border-success/25 bg-success-subtle",
  accent: "border-accent/25 bg-accent-subtle",
  neutral: "border-border bg-bg-subtle",
};

/** A boxed note inside a card: a warning, an outcome, an explanation. */
export function Notice({
  tone,
  title,
  children,
  className,
  live,
  testId,
}: {
  tone: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Announce it when it appears (outcomes after an action). */
  live?: boolean;
  testId?: string;
}) {
  const role = live ? (tone === "danger" || tone === "warning" ? "alert" : "status") : undefined;
  return (
    <div role={role} data-testid={testId} className={cn("flex gap-3 rounded-xl border p-4", NOTICE_BOX[tone], className)}>
      <StatusDot tone={tone} className="mt-1.5" />
      <div className="min-w-0 flex-1 text-sm text-fg [overflow-wrap:anywhere]">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn("flex flex-col gap-2 break-words", title ? "mt-1" : undefined)}>{children}</div>}
      </div>
    </div>
  );
}

/** A link to another site, opening in a new tab, saying so to screen readers. */
export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("font-semibold text-accent underline underline-offset-2 hover:no-underline", className)}
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** An address in full, monospaced, wrapping on narrow screens. */
export function Address({ value, className }: { value: string; className?: string }) {
  return <span className={cn("break-all font-mono text-[0.8125rem] text-fg", className)}>{value}</span>;
}

/** An address with its Etherscan link. */
export function AddressLink({ value }: { value: string }) {
  const href = addressUrl(value);
  return href ? (
    <ExternalLink href={href} className="break-all font-mono text-[0.8125rem] font-medium">
      {value}
    </ExternalLink>
  ) : (
    <Address value={value} />
  );
}

/** Copies a text to the clipboard and says so. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied("yes");
          } catch {
            setCopied("no");
          }
        }}
      >
        {label}
      </Button>
      <span role="status" className="text-xs text-fg-muted">
        {copied === "yes" ? "Copied" : copied === "no" ? "Could not copy: select the text instead" : ""}
      </span>
    </>
  );
}

/** A heading row plus rows of label/value pairs, readable at phone width. */
export function Facts({ rows, testId }: { rows: Array<[ReactNode, ReactNode]>; testId?: string }) {
  return (
    <dl className="flex flex-col divide-y divide-border text-sm" data-testid={testId}>
      {rows.map(([label, value], i) => (
        <div key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0">
          <dt className="text-fg-muted">{label}</dt>
          <dd className="min-w-0 text-right font-medium text-fg [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The owner-facing truth about the daemon's own transactions (package
 * settings: auto-tx gas threshold 20 gwei).
 */
export const AUTO_TX_THRESHOLD_GWEI = 20;

export function AutoTxNotice({ className }: { className?: string }) {
  return (
    <Notice tone="neutral" title="Your node also sends transactions by itself" className={className} testId="auto-tx-notice">
      <p>
        Rocket Pool does some things automatically from the node wallet: staking new validators when their turn comes in the queue,
        distributing rewards and keeping the contracts up to date. Each one pays a network fee from the node wallet.
      </p>
      <p>
        They wait only while the network fee is above {AUTO_TX_THRESHOLD_GWEI} gwei. Fees are almost always far lower, so in
        practice these transactions always go through. Keep at least 0.05 ETH in the node wallet for them.
      </p>
    </Notice>
  );
}
