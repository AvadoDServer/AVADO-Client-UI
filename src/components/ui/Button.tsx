import { forwardRef, type ButtonHTMLAttributes, type ElementType, type MouseEvent, type ReactNode, type Ref } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

/**
 * Button — token-driven, accessible. Ported from the AVADO Admin.
 *
 * variant: primary | secondary | outline | ghost | danger | success
 * size:    sm | md | lg (md is the 44px touch target default)
 * as:      render another element (an <a>, a router Link) with button styling
 */
const VARIANTS = {
  primary: "bg-accent text-accent-fg shadow-sm hover:bg-accent-hover active:bg-accent-active focus-visible:shadow-focus",
  secondary:
    "bg-surface text-fg border border-border hover:bg-surface-hover hover:border-border-strong focus-visible:shadow-focus",
  outline:
    "bg-transparent text-accent border border-accent/60 hover:bg-accent/10 hover:border-accent focus-visible:shadow-focus",
  ghost: "bg-transparent text-fg-muted hover:bg-fg/[0.06] hover:text-fg focus-visible:shadow-focus",
  danger:
    "bg-danger-solid text-danger-fg shadow-sm hover:brightness-110 active:brightness-95 focus-visible:shadow-focus",
  success:
    "bg-success-solid text-success-fg shadow-sm hover:brightness-110 active:brightness-95 focus-visible:shadow-focus",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;

// Appliance system: primary and secondary buttons are pills.
const PILL_VARIANTS = new Set<ButtonVariant>(["primary", "secondary"]);

const SIZES = {
  sm: "h-8 px-3.5 text-[0.8125rem] gap-1.5",
  md: "h-11 px-5 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2.5",
} as const;

export type ButtonSize = keyof typeof SIZES;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLElement> {
  as?: ElementType;
  variant?: ButtonVariant;
  size?: ButtonSize;
  pill?: boolean;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  /** Passed through when `as` renders a link. */
  href?: string;
  to?: string;
  target?: string;
  rel?: string;
  download?: string;
}

export const Button = forwardRef(function Button(
  {
    as: Tag = "button",
    variant = "primary",
    size = "md",
    pill = false,
    loading = false,
    disabled = false,
    leftIcon,
    rightIcon,
    className,
    children,
    type = "button",
    onClick,
    ...props
  }: ButtonProps,
  ref: Ref<HTMLElement>,
) {
  const isDisabled = disabled || loading;
  const isRealButton = Tag === "button";
  const isPill = pill || PILL_VARIANTS.has(variant);

  // `disabled` is a no-op on non-button elements; use the ARIA pattern.
  const extraDisabledProps = !isRealButton && isDisabled ? { "aria-disabled": "true", tabIndex: -1 } : {};

  const handleClick = (e: MouseEvent<HTMLElement>) => {
    if (!isRealButton && isDisabled) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };

  return (
    <Tag
      ref={ref}
      {...(isRealButton ? { type, disabled: isDisabled } : {})}
      {...extraDisabledProps}
      aria-busy={loading || undefined}
      onClick={handleClick}
      className={cn(
        "relative inline-flex select-none items-center justify-center whitespace-nowrap font-semibold transition-all duration-150 focus:outline-none",
        isPill ? "rounded-full" : "rounded-control",
        SIZES[size] ?? SIZES.md,
        VARIANTS[variant] ?? VARIANTS.primary,
        isDisabled && "pointer-events-none opacity-55",
        "active:translate-y-px",
        className,
      )}
      {...props}
    >
      {loading && <Spinner size={size === "lg" ? "md" : "sm"} aria-hidden />}
      {!loading && leftIcon}
      {children != null && <span className={loading ? "opacity-90" : undefined}>{children}</span>}
      {!loading && rightIcon}
    </Tag>
  );
});

export default Button;
