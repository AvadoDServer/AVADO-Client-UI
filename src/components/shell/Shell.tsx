import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useApi } from "../../api/ApiProvider";
import type { PackageState, Settings } from "../../api/types";
import { useClientConfigStatus } from "../../config/ClientConfigProvider";
import { POLL_MS, usePoll } from "../../hooks/usePoll";
import { useMode } from "../../settings/ModeProvider";
import { ClientIdentity } from "./ClientIdentity";
import { CLIENT_TITLE } from "./identity";
import { visibleNavItems } from "./navItems";
import { fetchNodeStatus } from "./nodeStatus";
import { SETTINGS_SAVED_EVENT } from "./events";
import { findProblems } from "./problems";
import { ShellFrame } from "./ShellFrame";
import { StatusStrip } from "./StatusStrip";

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

/**
 * The client app's shell: the shared frame (sidebar, top bar, banners) with
 * the client's identity, pages, status strip and problem banners.
 */
export function Shell() {
  const api = useApi();
  const { config, problems: configProblems } = useClientConfigStatus();
  const { isAdvanced } = useMode();
  const location = useLocation();

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

  return (
    <ShellFrame
      brand={<ClientIdentity />}
      compactBrand={<ClientIdentity size="sm" />}
      items={visibleNavItems(isAdvanced)}
      strip={<StatusStrip status={node.data} loading={node.loading} />}
      problems={problems}
    >
      <Outlet />
    </ShellFrame>
  );
}

export default Shell;
