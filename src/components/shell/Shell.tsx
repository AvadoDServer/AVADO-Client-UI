import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useApi } from "../../api/ApiProvider";
import type { Settings } from "../../api/types";
import { useClientConfigStatus } from "../../config/ClientConfigProvider";
import { useLocalPoll } from "../../hooks/useLocalPoll";
import { useMode } from "../../settings/ModeProvider";
import { Banners } from "./Banners";
import { CLIENT_TITLE } from "./identity";
import { fetchNodeStatus } from "./nodeStatus";
import { findProblems } from "./problems";
import { Sidebar } from "./Sidebar";
import { StatusStrip } from "./StatusStrip";
import { TopBar } from "./TopBar";

/** Spec §3: node status every 12 s. Settings and packages change rarely; re-read on every page change too. */
export const NODE_STATUS_INTERVAL_MS = 12_000;
export const PROBLEM_INPUTS_INTERVAL_MS = 30_000;

/** Fired by the settings page after a save, so the banners re-read the settings. */
export const SETTINGS_SAVED_EVENT = "avado:settings-saved";

const orNull = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

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
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);

  const node = useLocalPoll(() => fetchNodeStatus(api.beacon, isAdvanced), NODE_STATUS_INTERVAL_MS, isAdvanced ? "advanced" : "simple");
  const inputs = useLocalPoll(
    async () => {
      const [settings, packages] = await Promise.all([orNull<Settings>(api.backend.getSettings()), orNull(api.dappmanager.listPackages())]);
      return { settings, packages };
    },
    PROBLEM_INPUTS_INTERVAL_MS,
    location.pathname,
  );

  const problems = findProblems({
    client: config.client,
    network: config.network,
    packageName: config.packageName,
    configProblems,
    settings: inputs.data?.settings,
    packages: inputs.data?.packages,
    elOffline: node.data?.elOffline,
  });

  // A page that saves settings can ask for fresh banners right away:
  // window.dispatchEvent(new Event(SETTINGS_SAVED_EVENT)).
  const refreshInputs = inputs.refresh;
  useEffect(() => {
    window.addEventListener(SETTINGS_SAVED_EVENT, refreshInputs);
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, refreshInputs);
  }, [refreshInputs]);

  useEffect(() => {
    document.title = `AVADO ${CLIENT_TITLE[config.client]}`;
  }, [config.client]);

  // The drawer closes on navigation and on Escape (focus back to the menu button).
  useEffect(() => setMenuOpen(false), [location.pathname]);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useEffect(() => {
    if (!menuOpen) return;
    sidebar.current?.querySelector<HTMLElement>("a[href], button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <div className="min-h-screen">
      <TopBar ref={menuButton} menuOpen={menuOpen} onMenu={() => setMenuOpen(true)} />
      {menuOpen && (
        <div
          aria-hidden="true"
          data-testid="sidebar-overlay"
          onClick={closeMenu}
          className="fixed inset-0 z-30 bg-bg-inset/70 animate-fade-in lg:hidden"
        />
      )}
      <Sidebar ref={sidebar} open={menuOpen} onClose={closeMenu} />
      <div className="flex min-w-0 flex-col lg:pl-[15.5rem]">
        <StatusStrip status={node.data} loading={node.loading} />
        <main id="main" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Banners problems={problems} />
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default Shell;
