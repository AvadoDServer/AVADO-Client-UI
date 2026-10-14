/**
 * Building blocks shared by the Qtum pages, as in the Rocket Pool app: notes,
 * technical details (Advanced only), facts, copy buttons, cards. Phone first:
 * facts stack, rows wrap, nothing needs a table.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, CardDescription, CardTitle, Skeleton, StatusDot, cn } from "../../../components/ui";
import { useMode } from "../../../settings/ModeProvider";
import { errorDetails, plainError } from "../api/errors";

export type NoticeTone = "danger" | "warning" | "success" | "accent" | "neutral";

const NOTICE_BOX: Record<NoticeTone, string> = {
  danger: "border-danger/25 bg-danger-subtle",
  warning: "border-warning/25 bg-warning-subtle",
  success: "border-success/25 bg-success-subtle",
  accent: "border-accent/25 bg-accent-subtle",
  neutral: "border-border bg-bg-subtle",
};

/** A boxed note: a warning, an outcome, an explanation. */
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
 * the monitor's own message), folded away under "Details". Advanced mode
 * only: Simple mode shows the plain explanation alone.
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

/** A link to another page, opening in a new tab, saying so to screen readers. */
export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn("font-semibold text-accent underline underline-offset-2 hover:no-underline", className)}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** Copies a text to the clipboard and says so. */
export function CopyButton({ text, label = "Copy", srLabel }: { text: string; label?: string; srLabel?: string }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        aria-label={srLabel}
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
    </span>
  );
}

/** Rows of label/value pairs, readable at phone width. */
export function Facts({ rows, testId }: { rows: Array<[ReactNode, ReactNode]>; testId?: string }) {
  return (
    <dl className="flex flex-col divide-y divide-border text-sm" data-testid={testId}>
      {rows.map(([label, value], i) => (
        <div key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0">
          <dt className="text-fg-muted">{label}</dt>
          <dd className="min-w-0 text-right font-medium tabular-nums text-fg [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PageHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="min-w-0">
      <h1 className="font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">{title}</h1>
      {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
    </div>
  );
}

/** A card with a title, an optional description and actions. `title` names the region. */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  testId,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <Card as="section" aria-label={title} className={cn("flex flex-col gap-4", className)} data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}

export function LoadingLines() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

/** A read failed: the plain words, the details in Advanced, and a retry. */
export function LoadError({ what, error, onRetry }: { what: string; error: unknown; onRetry?: () => void }) {
  return (
    <Notice tone="danger" title={`Could not load ${what}`} live>
      <p>{plainError(error)}</p>
      <TechDetails error={error} />
      {onRetry && (
        <div>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </Notice>
  );
}
