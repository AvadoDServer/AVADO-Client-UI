import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Banners } from "./Banners";
import type { NavItem } from "./navItems";
import type { Problem } from "./problems";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
const LG_QUERY = "(min-width: 1024px)";
const DRAWER_SLIDE_MS = 200;

export interface ShellFrameProps {
  /** The app's identity at the top of the sidebar. */
  brand: ReactNode;
  /** The app's compact identity in the phone/tablet top bar. */
  compactBrand: ReactNode;
  /** The pages listed in the sidebar. */
  items: NavItem[];
  /** Shown above the page, full width (e.g. the client's status strip). */
  strip?: ReactNode;
  /** Problem banners above the page, most serious first. */
  problems?: Problem<string>[];
  /** The page (usually `<Outlet />`). */
  children: ReactNode;
}

const NO_PROBLEMS: Problem<string>[] = [];

/**
 * The layout every app shares: sidebar (a drawer below lg, with a top bar),
 * an optional strip, the problem banners and the page. The app supplies its
 * identity, pages and data.
 */
export function ShellFrame({ brand, compactBrand, items, strip, problems = NO_PROBLEMS, children }: ShellFrameProps) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const behind = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);

  // The drawer (below lg) is a modal dialog: focus moves in, Tab stays in,
  // the page behind is inert, and closing (Escape, overlay, navigation)
  // returns focus to the menu button. It closes on navigation and when the
  // window grows to lg, where the sidebar is docked.
  useEffect(() => setMenuOpen(false), [location.pathname]);
  // After closing, keep the drawer visible for the slide-out, then hide it
  // (out of the tab order). A timer, not transitionend, so it also works with
  // reduced motion and in background tabs.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (menuOpen) {
      wasOpen.current = true;
      setClosing(false);
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    setClosing(true);
    const t = setTimeout(() => setClosing(false), DRAWER_SLIDE_MS);
    return () => clearTimeout(t);
  }, [menuOpen]);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(LG_QUERY);
    const onChange = () => mq.matches && setMenuOpen(false);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const drawer = sidebar.current;
    const page = behind.current;
    const opener = menuButton.current;
    page?.setAttribute("inert", "");
    drawer?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        return;
      }
      if (e.key !== "Tab" || !drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && drawer.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      page?.removeAttribute("inert");
      // Give focus back to the menu button unless it already moved on (e.g. into the page).
      const active = document.activeElement;
      if (!active || active === document.body || (drawer && drawer.contains(active))) opener?.focus();
    };
  }, [menuOpen]);

  const skipToContent = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault(); // "#main" would be read as a route by the HashRouter
    main.current?.focus();
  };

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        onClick={skipToContent}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:font-semibold focus:text-fg focus:shadow-lg"
      >
        Skip to content
      </a>
      {menuOpen && (
        <div
          aria-hidden="true"
          data-testid="sidebar-overlay"
          onClick={closeMenu}
          className="fixed inset-0 z-30 bg-bg-inset/70 animate-fade-in lg:hidden"
        />
      )}
      <Sidebar ref={sidebar} open={menuOpen} closing={closing} onClose={closeMenu} brand={brand} items={items} />
      <div ref={behind} data-testid="page-behind-drawer">
        <TopBar ref={menuButton} menuOpen={menuOpen} onMenu={() => setMenuOpen(true)} identity={compactBrand} />
        <div className="flex min-w-0 flex-col lg:pl-[15.5rem]">
          {strip}
          <main
            ref={main}
            id="main"
            tabIndex={-1}
            className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 focus:outline-none sm:px-6 lg:px-8 lg:py-8"
          >
            <Banners problems={problems} />
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

export default ShellFrame;
