import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { ShellFrame } from "../../components/shell/ShellFrame";
import { useMode } from "../../settings/ModeProvider";
import { APP_TITLE, RocketpoolIdentity } from "./identity";
import { visibleRpNavItems } from "./nav";
import { AppStatusProvider, useAppStatus } from "./status/AppStatus";

function Frame() {
  const { isAdvanced } = useMode();
  const { problems } = useAppStatus();
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
