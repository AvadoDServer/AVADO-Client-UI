import type { ReactNode } from "react";
import { cn } from "./cn";

export type StatusTone = "success" | "warning" | "danger" | "accent" | "neutral";

const DOT_TONE: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  accent: "bg-accent",
  neutral: "bg-fg-subtle",
};

// Text only turns tone-coloured for states that need attention; a healthy
// state reads as quiet muted text and only the dot carries the green.
const TEXT_TONE: Record<StatusTone, string> = {
  success: "text-fg-muted",
  warning: "text-warning-text",
  danger: "text-danger-text",
  accent: "text-accent",
  neutral: "text-fg-muted",
};

export function StatusDot({ tone = "neutral", className }: { tone?: StatusTone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-tone={tone}
      className={cn("inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full", DOT_TONE[tone] ?? DOT_TONE.neutral, className)}
    />
  );
}

export interface StatusPillProps {
  status: { tone: StatusTone; label: ReactNode } | null | undefined;
  className?: string;
}

/** StatusPill — the "status light": a small dot plus its word. */
export function StatusPill({ status, className }: StatusPillProps) {
  const tone: StatusTone = status?.tone ?? "neutral";
  return (
    <span
      data-tone={tone}
      className={cn("inline-flex items-center gap-2 text-sm font-medium leading-5", TEXT_TONE[tone], className)}
    >
      <StatusDot tone={tone} />
      {status?.label}
    </span>
  );
}

export default StatusPill;
