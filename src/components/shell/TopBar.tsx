import { forwardRef, type ReactNode } from "react";
import { SIDEBAR_ID } from "./Sidebar";
import { MenuIcon } from "./icons";

export interface TopBarProps {
  menuOpen: boolean;
  onMenu: () => void;
  /** The app's compact identity (e.g. `<ClientIdentity size="sm" />`). */
  identity: ReactNode;
}

/** Phone and tablet top bar (below lg): the menu button and the app's identity. */
export const TopBar = forwardRef<HTMLButtonElement, TopBarProps>(function TopBar({ menuOpen, onMenu, identity }, ref) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border bg-chrome px-2 sm:px-4 lg:hidden">
      <button
        ref={ref}
        type="button"
        onClick={onMenu}
        aria-label="Open menu"
        aria-expanded={menuOpen}
        aria-controls={SIDEBAR_ID}
        className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-fg/[0.06] hover:text-fg focus-visible:shadow-focus focus-visible:outline-none"
      >
        <MenuIcon />
      </button>
      {identity}
    </header>
  );
});

export default TopBar;
