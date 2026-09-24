/**
 * Building blocks shared by the Rocket Pool pages: the page header, the
 * "is the node ready" gate, notes, fact lists and addresses. Phone first:
 * facts stack, rows wrap, nothing needs a table.
 */
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, Card, CardDescription, CardTitle, Skeleton, StatusDot, cn } from "../../../components/ui";
import { plainError } from "../api/errors";
import { addressUrl } from "../lib/explorer";
import { shortAddress } from "../lib/units";
import { useAppStatus } from "../status/AppStatus";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export type NoteTone = "danger" | "warning" | "success" | "accent" | "neutral";

const NOTE_BOX: Record<NoteTone, string> = {
  danger: "border-danger/25 bg-danger-subtle",
  warning: "border-warning/25 bg-warning-subtle",
  success: "border-success/25 bg-success-subtle",
  accent: "border-accent/25 bg-accent-subtle",
  neutral: "border-border bg-surface",
};

/** A tinted note with a status dot: warnings, explanations, outcomes. */
export function Callout({
  tone = "neutral",
  title,
  children,
  className,
  role,
}: {
  tone?: NoteTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  role?: "alert" | "status" | "note";
}) {
  return (
    <div role={role} className={cn("flex gap-3 rounded-xl border p-4 text-sm", NOTE_BOX[tone], className)}>
      <StatusDot tone={tone} className="mt-1.5" />
      <div className="min-w-0 flex-1 text-fg">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn("flex flex-col gap-2 break-words", title ? "mt-1" : undefined)}>{children}</div>}
      </div>
    </div>
  );
}

/** A read failed: Smartnode's or the backend's message in plain words, and a retry. */
export function LoadError({ what, error, onRetry }: { what: string; error: unknown; onRetry?: () => void }) {
  return (
    <Callout tone="danger" title={`Could not load ${what}`} role="alert">
      <p>{plainError(error)}</p>
      {onRetry && (
        <div>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </Callout>
  );
}

export interface Fact {
  label: ReactNode;
  value: ReactNode;
  /** Extra line under the value. */
  hint?: ReactNode;
}

/** Label / value pairs: two columns on wide screens, stacked on a phone. */
export function Facts({ items, className }: { items: Fact[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2", className)}>
      {items.map((f, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">{f.label}</dt>
          <dd className="mt-0.5 break-words font-medium text-fg">{f.value}</dd>
          {f.hint && <dd className="mt-0.5 text-xs text-fg-muted">{f.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** An address, shortened, with the full value for screen readers and a link to Etherscan. */
export function Address({ address, full = false }: { address: string; full?: boolean }) {
  const href = addressUrl(address);
  const text = full ? address : shortAddress(address);
  if (!href) return <span className="font-mono">{text}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={address}
      className="break-all font-mono text-accent underline-offset-2 hover:underline"
    >
      {text}
      <span className="sr-only"> (full address {address}, opens Etherscan in a new tab)</span>
    </a>
  );
}

/** Copies text to the clipboard, and says so. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied" : label}
      <span className="sr-only" aria-live="polite">
        {copied ? " to the clipboard" : ""}
      </span>
    </Button>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  ...rest
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <Card className={cn("flex flex-col gap-4", className)} {...rest}>
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

export function LoadingCard({ label }: { label: string }) {
  return (
    <Card className="flex flex-col gap-3" aria-busy="true" aria-label={label}>
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </Card>
  );
}

/**
 * Shows its children only when Smartnode can answer: the daemon runs and a
 * wallet exists. Otherwise it says why, in plain words, and where to go.
 */
export function NodeGate({ children }: { children: ReactNode }) {
  const { avado, loading, daemonReady, avadoFailed } = useAppStatus();
  if (loading && !avado) return <LoadingCard label="Checking Rocket Pool" />;
  if (avadoFailed || !avado) {
    return (
      <Callout tone="danger" title="The Rocket Pool package is not answering">
        <p>This page needs the Rocket Pool service. Check that the package is running in the AVADO Admin.</p>
      </Callout>
    );
  }
  if (!avado.walletFilePresent) {
    return (
      <Callout tone="accent" title="Your node isn't set up yet">
        <p>Create or restore the node wallet first.</p>
        <div>
          <Button as={Link} to="/setup" size="sm">
            Set up your node
          </Button>
        </div>
      </Callout>
    );
  }
  if (!daemonReady) {
    return (
      <Callout tone="warning" title="Rocket Pool isn't ready yet">
        <p>
          The Rocket Pool service is starting or stopped, so this page can't be shown right now. It updates by itself once the
          service is running.
        </p>
        <div>
          <Button as={Link} to="/advanced" variant="secondary" size="sm">
            See the service status and logs
          </Button>
        </div>
      </Callout>
    );
  }
  return <>{children}</>;
}
