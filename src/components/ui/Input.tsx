import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { cn } from "./cn";

const baseField =
  "w-full rounded-control border bg-surface text-fg placeholder:text-fg-subtle transition-colors duration-150 focus:outline-none focus-visible:border-accent focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-55";

const SIZES = {
  sm: "h-8 px-2.5 text-[0.8125rem]",
  md: "h-11 px-3.5 text-sm",
  lg: "h-12 px-4 text-base",
} as const;

export type FieldSize = keyof typeof SIZES;

interface FieldChrome {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  id?: string;
  required?: boolean;
  className?: string;
}

function Field({
  label,
  hint,
  error,
  id,
  required,
  className,
  children,
}: FieldChrome & { children: (a: { fieldId: string; describedBy?: string; invalid: boolean }) => ReactNode }) {
  const reactId = useId();
  const fieldId = id || reactId;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={fieldId} className="text-sm font-medium text-fg-muted">
          {label}
          {required && (
            <span aria-hidden="true" className="ml-0.5 text-danger-text">
              *
            </span>
          )}
        </label>
      )}
      {children({ fieldId, describedBy, invalid: Boolean(error) })}
      {error ? (
        <span id={`${fieldId}-error`} className="text-xs text-danger-text">
          {error}
        </span>
      ) : hint ? (
        <span id={`${fieldId}-hint`} className="text-xs text-fg-subtle">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size">, FieldChrome {
  /** Height; `size` stays free for the native attribute semantics. */
  inputSize?: FieldSize;
}

/** Input — labelled, accessible text field with hint/error states. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, inputSize = "md", id, required, className, ...props },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} id={id} required={required} className={className}>
      {({ fieldId, describedBy, invalid }) => (
        <input
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(baseField, SIZES[inputSize] ?? SIZES.md, invalid ? "border-danger" : "border-border")}
          {...props}
        />
      )}
    </Field>
  );
});

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size">, FieldChrome {
  inputSize?: FieldSize;
}

/** Select — same field chrome as Input, with a custom chevron. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, inputSize = "md", id, required, className, children, ...props },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} id={id} required={required} className={className}>
      {({ fieldId, describedBy, invalid }) => (
        <div className="relative">
          <select
            ref={ref}
            id={fieldId}
            required={required}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cn(
              baseField,
              SIZES[inputSize] ?? SIZES.md,
              "cursor-pointer appearance-none pr-9",
              invalid ? "border-danger" : "border-border",
            )}
            {...props}
          >
            {children}
          </select>
          <svg
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      )}
    </Field>
  );
});

export default Input;
