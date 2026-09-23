import { forwardRef, type ElementType, type HTMLAttributes, type Ref } from "react";
import { cn } from "./cn";

const PADDING = { none: "", sm: "p-4", md: "p-5", lg: "p-6" } as const;

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  interactive?: boolean;
  padding?: keyof typeof PADDING;
}

/** Card — the canonical surface container. Ported from the AVADO Admin. */
export const Card = forwardRef(function Card(
  { as: Tag = "div", interactive = false, padding = "md", className, children, ...props }: CardProps,
  ref: Ref<HTMLElement>,
) {
  return (
    <Tag
      ref={ref}
      className={cn(
        // Appliance panels: radius 20, no border in light (a 1px bottom
        // "shelf" shadow stands in for it), a hairline border in dark.
        "relative rounded-xl bg-surface text-fg shadow-[0_1px_0_rgb(var(--border))] transition-all duration-200 dark:border dark:border-border dark:shadow-none",
        PADDING[padding] ?? PADDING.md,
        interactive &&
          "cursor-pointer hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:shadow-focus dark:hover:border-accent/60",
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
});

export function CardHeader({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-3", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("text-base font-semibold leading-tight text-fg", className)} {...props}>
      {children}
    </h3>
  );
}

export function CardDescription({ className, children, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("mt-1 text-sm text-fg-muted", className)} {...props}>
      {children}
    </p>
  );
}

export default Card;
