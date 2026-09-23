import { forwardRef } from "react";
import { ClientIdentity } from "./ClientIdentity";
import { MenuIcon } from "./icons";
import { SIDEBAR_ID } from "./Sidebar";

/** Phone and tablet top bar (below lg): the menu button and the client identity. */
export const TopBar = forwardRef<HTMLButtonElement, { menuOpen: boolean; onMenu: () => void }>(function TopBar(
  { menuOpen, onMenu },
  ref,
) {
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
      <ClientIdentity size="sm" />
    </header>
  );
});

export default TopBar;
