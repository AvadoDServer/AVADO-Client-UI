import type { HTMLAttributes } from "react";
import { cn } from "./cn";

const RADIUS = { sm: "rounded-sm", md: "rounded-md", lg: "rounded-lg", full: "rounded-full" } as const;

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  rounded?: keyof typeof RADIUS;
}

/** Skeleton — shimmer placeholder for loading states (.ui-skeleton in index.css). */
export function Skeleton({ className, rounded = "md", ...props }: SkeletonProps) {
  return <div aria-hidden="true" className={cn("ui-skeleton", RADIUS[rounded] ?? RADIUS.md, className)} {...props} />;
}

export default Skeleton;
