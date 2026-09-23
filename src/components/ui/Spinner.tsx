import type { HTMLAttributes } from "react";
import { cn } from "./cn";

const SIZES = {
  xs: "h-3.5 w-3.5 border-[2px]",
  sm: "h-4 w-4 border-2",
  md: "h-5 w-5 border-2",
  lg: "h-8 w-8 border-[3px]",
  xl: "h-12 w-12 border-4",
} as const;

export type SpinnerSize = keyof typeof SIZES;

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
  label?: string;
}

/** Accessible loading spinner; the arc uses currentColor. */
export function Spinner({ size = "md", className, label = "Loading", ...props }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "inline-block animate-spin-slow rounded-full border-current border-r-transparent align-[-0.125em] opacity-80",
        SIZES[size] ?? SIZES.md,
        className,
      )}
      {...props}
    />
  );
}

export default Spinner;
