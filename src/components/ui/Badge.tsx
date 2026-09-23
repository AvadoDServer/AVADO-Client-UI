import type { HTMLAttributes } from "react";
import { cn } from "./cn";

const VARIANTS = {
  neutral: "bg-fg/[0.06] text-fg-muted border border-border",
  accent: "bg-accent/[0.12] text-accent border border-accent/25",
  success: "bg-success-subtle text-success-text border border-success/25",
  warning: "bg-warning-subtle text-warning-text border border-warning/25",
  danger: "bg-danger-subtle text-danger-text border border-danger/25",
} as const;

const DOT = {
  neutral: "bg-fg-subtle",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
} as const;

export type BadgeVariant = keyof typeof VARIANTS;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  dot?: boolean;
}

/** Badge — compact status pill. */
export function Badge({ variant = "neutral", dot = false, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5",
        VARIANTS[variant] ?? VARIANTS.neutral,
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn("h-1.5 w-1.5 rounded-full", DOT[variant] ?? DOT.neutral, variant !== "neutral" && "animate-pulse-soft")}
        />
      )}
      {children}
    </span>
  );
}

export default Badge;
