import { useEffect, useMemo } from "react";
import { Outlet } from "react-router-dom";
import { ShellFrame } from "../../components/shell/ShellFrame";
import { useMode } from "../../settings/ModeProvider";
import { APP_TITLE, RocketpoolIdentity } from "./identity";
import { visibleRpNavItems } from "./nav";
import { AppStatusProvider, useAppStatus } from "./status/AppStatus";
import { findPendingProblems, forMode } from "./status/problems";
import { usePendingTxs } from "./tx/pending";

function Frame() {
  const { isAdvanced } = useMode();
  const { problems: statusProblems } = useAppStatus();
  const pending = usePendingTxs();
  const problems = useMemo(() => {
    const all = [...statusProblems, ...findPendingProblems(pending.list(), (k) => pending.isOverdue(k))];
    const order = { danger: 0, warning: 1, accent: 2 } as const;
    return all.sort((a, b) => order[a.tone] - order[b.tone]).map((p) => forMode(p, isAdvanced));
    // pending.getVersion() changes whenever the store does
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusProblems, pending, pending.getVersion(), isAdvanced]);
  return (
    <ShellFrame
      brand={<RocketpoolIdentity />}
      compactBrand={<RocketpoolIdentity size="sm" />}
      items={visibleRpNavItems(isAdvanced)}
      problems={problems}
    >
      <Outlet />
    </ShellFrame>
  );
}

/** The Rocket Pool app's shell: the shared frame with its own identity, pages and status banners. */
export function RocketpoolShell() {
  useEffect(() => {
    document.title = `AVADO ${APP_TITLE}`;
  }, []);
  return (
    <AppStatusProvider>
      <Frame />
    </AppStatusProvider>
  );
}

export default RocketpoolShell;
