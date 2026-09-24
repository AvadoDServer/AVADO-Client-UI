import { useEffect, useState, type ReactNode } from "react";
import { Button, StatusDot, cn } from "../../../components/ui";
import { useMode } from "../../../settings/ModeProvider";
import { errorDetails } from "../api/errors";
import { addressUrl } from "../lib/explorer";
import { daemonSettings, gweiToWei } from "../pages/advanced/automatic";
import { useAppStatus } from "../status/AppStatus";

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

/**
 * The technical side of a problem (the error's route, status and raw text, or
 * log lines), folded away under "Details". Advanced mode only: Simple mode
 * shows the plain explanation alone.
 */
export function TechDetails({ error, lines, className }: { error?: unknown; lines?: string[]; className?: string }) {
  const { isAdvanced } = useMode();
  if (!isAdvanced) return null;
  const all = [...(error !== undefined ? [errorDetails(error)] : []), ...(lines ?? [])].filter((l): l is string => !!l && l.trim() !== "");
  if (all.length === 0) return null;
  return (
    <details className={cn("text-xs text-fg-muted", className)} data-testid="tech-details">
      <summary className="cursor-pointer font-medium">Details</summary>
      <ul className="mt-1 flex flex-col gap-1 font-mono [overflow-wrap:anywhere]">
        {all.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </details>
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
 * The owner-facing truth about the daemon's own transactions. The gas
 * threshold is the one `/api/avado/status` reports (`settings`), else the
 * package template's (20 gwei, `pages/advanced/automatic.ts`).
 */
export function AutoTxNotice({ className }: { className?: string }) {
  const { avado } = useAppStatus();
  const threshold = daemonSettings(avado).values.autoTxGasThreshold;
  const off = gweiToWei(threshold) === 0n;
  return (
    <Notice tone="neutral" title="Your node also sends transactions by itself" className={className} testId="auto-tx-notice">
      <p>
        Rocket Pool does some things by itself from the node wallet: starting new validators when their turn comes, paying out rewards
        and keeping its contracts up to date. Each one pays a small network fee from the node wallet.
      </p>
      {off ? (
        <p>
          This package's settings turn off the optional ones (such as paying out rewards); the essential ones, such as starting new
          validators, still go through. Keep at least 0.05 ETH in the node wallet for them.
        </p>
      ) : (
        <p>
          They only wait while network fees are unusually high (above {threshold} gwei, the unit fees are measured in), which is rare. Keep
          at least 0.05 ETH in the node wallet for them.
        </p>
      )}
    </Notice>
  );
}
