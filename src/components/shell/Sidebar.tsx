import { forwardRef } from "react";
import { NavLink } from "react-router-dom";
import { useMode } from "../../settings/ModeProvider";
import { cn } from "../ui";
import { ClientIdentity } from "./ClientIdentity";
import { CloseIcon } from "./icons";
import { visibleNavItems } from "./navItems";
import { SidebarFooter } from "./SidebarFooter";

export const SIDEBAR_ID = "sidebar";

export interface SidebarProps {
  /**
   * Below lg the sidebar is an off-canvas drawer; this opens it (then it is a
   * modal dialog). Docked open from lg up.
   */
  open: boolean;
  /** Just closed: still sliding out (visible). Then it is hidden and out of the tab order. */
  closing?: boolean;
  onClose: () => void;
}

/**
 * The Admin's sidebar: client identity at the top, the pages, and the footer
 * with the theme and mode switches. Advanced-only pages are listed in
 * Advanced mode only.
 */
export const Sidebar = forwardRef<HTMLElement, SidebarProps>(function Sidebar({ open, closing = false, onClose }, ref) {
  const { isAdvanced } = useMode();
  return (
    <aside
      ref={ref}
      id={SIDEBAR_ID}
      aria-label={open ? "Menu" : "Sidebar"}
      {...(open ? { role: "dialog", "aria-modal": true } : {})}
      data-open={open}
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex w-[15.5rem] max-w-[85vw] flex-col overflow-y-auto overflow-x-hidden border-r border-border bg-surface",
        "transition-transform duration-200 ease-out motion-reduce:transition-none",
        "lg:visible lg:translate-x-0",
        // Visibility never transitions: visible at once on open (so focus can
        // move in), hidden by the shell's timer once the slide-out is done.
        open
          ? "visible translate-x-0 shadow-xl lg:shadow-none"
          : closing
            ? "visible -translate-x-full"
            : "invisible -translate-x-full",
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-1 px-4 py-6">
        <div className="flex items-start justify-between gap-2 px-2 pb-6">
          <NavLink to="/" onClick={onClose} className="min-w-0 rounded-md no-underline focus-visible:shadow-focus focus-visible:outline-none">
            <ClientIdentity />
          </NavLink>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="-mr-2 -mt-1 inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-fg/[0.06] hover:text-fg focus-visible:shadow-focus focus-visible:outline-none lg:hidden"
          >
            <CloseIcon />
          </button>
        </div>

        <nav aria-label="Main" className="flex flex-col gap-1">
          {visibleNavItems(isAdvanced).map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "flex h-[2.875rem] flex-shrink-0 items-center gap-3 rounded-lg px-3.5 text-[0.9375rem] no-underline transition-colors",
                  "focus-visible:shadow-focus focus-visible:outline-none",
                  isActive
                    ? "bg-accent font-semibold text-accent-fg hover:text-accent-fg"
                    : "font-medium text-fg-muted hover:bg-fg/[0.05] hover:text-fg",
                )
              }
            >
              <Icon className="flex-shrink-0" />
              <span className="truncate">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="flex-auto" />
        <div className="pt-4">
          <SidebarFooter />
        </div>
      </div>
    </aside>
  );
});

export default Sidebar;
