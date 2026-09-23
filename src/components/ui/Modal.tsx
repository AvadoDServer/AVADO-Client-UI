import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";

const SIZES = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-2xl" } as const;

export interface ModalProps {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZES;
  closeOnBackdrop?: boolean;
  className?: string;
}

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function focusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("inert") && el.getAttribute("aria-hidden") !== "true",
  );
}

/** Keep Tab / Shift+Tab cycling inside the dialog panel. */
function trapTab(e: KeyboardEvent, panel: HTMLElement) {
  const items = focusables(panel);
  const active = document.activeElement as HTMLElement | null;
  if (items.length === 0) {
    e.preventDefault();
    panel.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const inside = !!active && panel.contains(active);
  if (e.shiftKey) {
    if (!inside || active === first || active === panel) {
      e.preventDefault();
      last.focus();
    }
  } else if (!inside || active === last) {
    e.preventDefault();
    first.focus();
  }
}

// While any dialog is open, the app behind it is inert (not focusable or
// clickable, hidden from assistive tech). Counted, so stacked dialogs work.
let inertCount = 0;
function makeAppInert(): () => void {
  const root = document.getElementById("root");
  if (!root) return () => {};
  inertCount += 1;
  root.setAttribute("inert", "");
  return () => {
    inertCount = Math.max(0, inertCount - 1);
    if (inertCount === 0) root.removeAttribute("inert");
  };
}

/**
 * Modal — ported from the AVADO Admin.
 *  - Portal into document.body; closes on Escape and backdrop click.
 *  - Locks body scroll, makes #root inert, moves focus in, traps Tab and
 *    Shift+Tab inside the panel, and returns focus on close.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeOnBackdrop = true,
  className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current?.();
        return;
      }
      if (e.key === "Tab" && panelRef.current) trapTab(e, panelRef.current);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const releaseInert = makeAppInert();
    const t = setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      releaseInert();
      clearTimeout(t);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[5000] flex items-center justify-center p-4">
      <div
        data-testid="modal-backdrop"
        className="absolute inset-0 animate-fade-in bg-bg-inset/70 backdrop-blur-sm"
        onClick={closeOnBackdrop ? onClose : undefined}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          "relative max-h-[90vh] w-full animate-rise overflow-y-auto rounded-xl bg-surface-raised text-fg shadow-xl focus:outline-none dark:border dark:border-border",
          SIZES[size] ?? SIZES.md,
          className,
        )}
      >
        {(title || onClose) && (
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
            <div>
              {title && (
                <h2 id={titleId} className="text-lg font-semibold text-fg">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descId} className="mt-1 text-sm text-fg-muted">
                  {description}
                </p>
              )}
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="-mr-2 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-fg/[0.06] hover:text-fg focus:outline-none focus-visible:shadow-focus"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-6 py-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default Modal;
