import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useApi } from "../../api/ApiProvider";
import type { PackageState, Settings } from "../../api/types";
import { useClientConfigStatus } from "../../config/ClientConfigProvider";
import { POLL_MS, usePoll } from "../../hooks/usePoll";
import { useMode } from "../../settings/ModeProvider";
import { Banners } from "./Banners";
import { CLIENT_TITLE } from "./identity";
import { fetchNodeStatus } from "./nodeStatus";
import { SETTINGS_SAVED_EVENT } from "./events";
import { findProblems } from "./problems";
import { Sidebar } from "./Sidebar";
import { StatusStrip } from "./StatusStrip";
import { TopBar } from "./TopBar";

/** Spec §3: node status every 12 s. Settings and packages change rarely; re-read on every page change too. */
export const NODE_STATUS_INTERVAL_MS = POLL_MS.nodeStatus;
export const PROBLEM_INPUTS_INTERVAL_MS = 30_000;

export { SETTINGS_SAVED_EVENT };

/** Call `refresh` when `value` changes (not on the first render). */
function useRefreshOnChange(value: unknown, refresh: () => Promise<void>) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void refresh();
  }, [value, refresh]);
}

/** A failed read is undefined ("unknown"), so the last known value is kept. */
const orUndefined = <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);

interface ProblemData {
  settings?: Settings;
  packages?: PackageState[];
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
const LG_QUERY = "(min-width: 1024px)";
const DRAWER_SLIDE_MS = 200;

/**
 * The app shell: sidebar (a drawer below lg, with a top bar), the status
 * strip, the problem banners and the page.
 */
export function Shell() {
  const api = useApi();
  const { config, problems: configProblems } = useClientConfigStatus();
  const { isAdvanced } = useMode();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const behind = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);

  const node = usePoll(
    () => fetchNodeStatus(api.beacon, isAdvanced, { client: config.client, serviceStatus: () => api.backend.serviceStatus() }),
    NODE_STATUS_INTERVAL_MS,
  );
  // Advanced mode adds strip fields: read again at once, keeping what is shown.
  useRefreshOnChange(isAdvanced, node.refresh);
  // Settings and packages for the banners. A read that fails (backend
  // restarting, WAMP down) keeps the last known value: never "not installed".
  const lastKnown = useRef<ProblemData>({});
  const inputs = usePoll(
    async () => {
      const [settings, packages] = await Promise.all([
        orUndefined<Settings>(api.backend.getSettings()),
        orUndefined<PackageState[]>(api.dappmanager.listPackageStates()),
      ]);
      const next: ProblemData = {
        settings: settings ?? lastKnown.current.settings,
        packages: packages ?? lastKnown.current.packages,
      };
      lastKnown.current = next;
      return next;
    },
    PROBLEM_INPUTS_INTERVAL_MS,
  );
  // Every page change re-reads them, keeping the banners shown meanwhile.
  useRefreshOnChange(location.pathname, inputs.refresh);

  const problems = findProblems({
    client: config.client,
    network: config.network,
    packageName: config.packageName,
    configProblems,
    settings: inputs.data?.settings,
    packages: inputs.data?.packages,
    elOffline: node.data?.elOffline,
  });

  // A page that saves settings asks for fresh banners right away
  // (`notifySettingsSaved()` from ./events).
  const refreshInputs = inputs.refresh;
  useEffect(() => {
    const onSaved = () => void refreshInputs();
    window.addEventListener(SETTINGS_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, onSaved);
  }, [refreshInputs]);

  useEffect(() => {
    document.title = `AVADO ${CLIENT_TITLE[config.client]}`;
  }, [config.client]);

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
      const items = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
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
      <Sidebar ref={sidebar} open={menuOpen} closing={closing} onClose={closeMenu} />
      <div ref={behind} data-testid="page-behind-drawer">
        <TopBar ref={menuButton} menuOpen={menuOpen} onMenu={() => setMenuOpen(true)} />
        <div className="flex min-w-0 flex-col lg:pl-[15.5rem]">
          <StatusStrip status={node.data} loading={node.loading} />
          <main
            ref={main}
            id="main"
            tabIndex={-1}
            className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 focus:outline-none sm:px-6 lg:px-8 lg:py-8"
          >
            <Banners problems={problems} />
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

export default Shell;
