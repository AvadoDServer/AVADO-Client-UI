import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { ShellFrame } from "../../components/shell/ShellFrame";
import { useMode } from "../../settings/ModeProvider";
import { APP_TITLE, RocketpoolIdentity } from "./identity";
import { visibleRpNavItems } from "./nav";

/** The Rocket Pool app's shell: the shared frame with its own identity and pages. */
export function RocketpoolShell() {
  const { isAdvanced } = useMode();
  useEffect(() => {
    document.title = `AVADO ${APP_TITLE}`;
  }, []);
  return (
    <ShellFrame brand={<RocketpoolIdentity />} compactBrand={<RocketpoolIdentity size="sm" />} items={visibleRpNavItems(isAdvanced)}>
      <Outlet />
    </ShellFrame>
  );
}

export default RocketpoolShell;
